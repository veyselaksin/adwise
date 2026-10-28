import "server-only";

// Server-side only: the API URL (and later the auth token) never reach the browser.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Mirrors the server's response envelope. */
type ApiResponse<T> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; error: { code: string } };

export type Health = {
  status: "ok";
  uptime: number;
  version: string;
};

export async function getHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    const body = (await res.json()) as ApiResponse<Health>;
    return body.success ? body.data : null;
  } catch {
    return null;
  }
}
