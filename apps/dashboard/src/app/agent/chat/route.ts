import type { NextRequest } from "next/server";
import { ApiError, askAgent } from "@lib/api";
import { fail, ndjsonResponse, passError } from "@lib/ndjson";
import type { ChatMessage } from "@typings/agent";

/**
 * POST /agent/chat { messages, model? } → the agent's NDJSON stream, passed through
 * from the API so the token and API URL stay on the server. Closing the
 * request (stop button, panel closed) cancels the upstream call too.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { messages?: ChatMessage[]; model?: unknown } | null;
  if (!Array.isArray(body?.messages)) return fail(400, "VALIDATION_ERROR", "Send { messages: [...] }");

  let upstream: Response | null;
  try {
    // The API checks the model id against its list.
    upstream = await askAgent(body.messages, typeof body.model === "string" ? body.model : undefined, request.signal);
  } catch (err) {
    if (err instanceof ApiError) return fail(502, err.code, err.message);
    throw err;
  }
  if (!upstream) return fail(401, "UNAUTHORIZED", "Your session ended. Sign in again.");

  if (!upstream.ok || !upstream.body) return passError(upstream);
  return ndjsonResponse(upstream.body);
}
