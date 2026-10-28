import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./session";
import type {
  AgentModels,
  Brief,
  BudgetPacing,
  Catalog,
  ChatMessage,
  Entities,
  InvestigationRequest,
  MetricsQuery,
  MetricsResult,
  Pin,
  PinResult,
  Release,
  Rule,
} from "./types";

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

/** Last `days` full days' spend against each ad set's current budget; independent of the date filter. */
export const getBudgetPacing = (days?: number) =>
  authed<BudgetPacing>(`/budgets/pacing${days ? `?days=${days}` : ""}`);

/** App releases shipped in `range` (by release day), with their commits. */
export const getReleases = (range: { from: string; to: string }) =>
  authed<Release[]>(`/releases?${new URLSearchParams(range)}`);

/** What changed yesterday, from the server's fixed checks; ignores the overview's filters. */
export const getBrief = () => authed<Brief>("/brief");

export const getPins = () => authed<Pin[]>("/pins");

/** A pinned tile's query, run now. */
export const getPinResult = (id: string) => authed<PinResult>(`/pins/${encodeURIComponent(id)}/result`);

export const createPin = (title: string, query: Record<string, unknown>) =>
  authed<Pin>("/pins", { method: "POST", body: JSON.stringify({ title, query }) });

export const deletePin = (id: string) => authed<Pin>(`/pins/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getRules = () => authed<Rule[]>("/rules");

export const createRule = (text: string) => authed<Rule>("/rules", { method: "POST", body: JSON.stringify({ text }) });

export const updateRule = (id: string, changes: { text?: string; enabled?: boolean }) =>
  authed<Rule>(`/rules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) });

export const deleteRule = (id: string) => authed<Rule>(`/rules/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getAgentModels = () => authed<AgentModels>("/agent/models");

/**
 * Asks the agent. Returns the API's response as is, because a successful one is
 * a stream (NDJSON) for the browser to read step by step; errors keep the envelope.
 * `null` when there is no session.
 */
export const askAgent = (messages: ChatMessage[], model: string | undefined, signal: AbortSignal) =>
  streamFrom("/agent/chat", { messages, ...(model && { model }) }, signal);

/**
 * Starts an investigation of one campaign's period against the one before it.
 * Like `askAgent`, a successful response is an NDJSON stream; `null` without a session.
 */
export const runInvestigation = (request: InvestigationRequest, signal: AbortSignal) =>
  streamFrom("/investigations", request, signal);

async function streamFrom(path: string, body: unknown, signal: AbortSignal): Promise<Response | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await fetch(`${API_URL}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError("API_UNREACHABLE", "The API is not reachable. Try again in a moment.");
  }
}
