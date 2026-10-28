import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./session";
import type { Catalog, Entities, MetricsQuery, MetricsResult } from "./types";

// Server-side only: the API URL and the session token never reach the browser.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Mirrors the server's response envelope. */
type ApiResponse<T> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; error: { code: string } };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("API_UNREACHABLE", "The API is not reachable. Try again in a moment.");
  }
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiError("BAD_RESPONSE", `Unexpected response from the API (${res.status})`);
  if (!body.success) throw new ApiError(body.error.code, body.message);
  return body.data;
}

/** Calls a protected endpoint with the session token; a missing or expired session goes to sign-in. */
async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    return await request<T>(path, init, token);
  } catch (err) {
    if (err instanceof ApiError && err.code === "UNAUTHORIZED") redirect("/login?expired=1");
    throw err;
  }
}

export type Health = { status: "ok"; uptime: number; version: string };

export async function getHealth(): Promise<Health | null> {
  try {
    return await request<Health>("/health");
  } catch {
    return null;
  }
}

export const login = (username: string, password: string) =>
  request<{ token: string; expiresIn: number; user: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const getCatalog = () => authed<Catalog>("/metrics/catalog");

export const getEntities = () => authed<Entities>("/entities");

export const queryMetrics = (query: MetricsQuery) =>
  authed<MetricsResult>("/metrics/query", { method: "POST", body: JSON.stringify(query) });
