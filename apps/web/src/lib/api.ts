import "server-only";

// Server-side only: the API URL (and later the auth token) never reach the browser.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type HealthResponse = {
  status: "ok";
  uptime: number;
  version: string;
};

export async function getHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}
