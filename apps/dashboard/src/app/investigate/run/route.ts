import type { NextRequest } from "next/server";
import { ApiError, runInvestigation } from "@/lib/api";
import { fail, ndjsonResponse, passError } from "@/lib/ndjson";

/**
 * POST /investigate/run { campaignId, from, to, model? } → the investigation's NDJSON
 * stream, passed through from the API so the token and API URL stay on the server.
 * The API validates the fields; leaving the page cancels the upstream call.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { campaignId, from, to, model } = body ?? {};
  if (typeof campaignId !== "string" || typeof from !== "string" || typeof to !== "string") {
    return fail(400, "VALIDATION_ERROR", "Send { campaignId, from, to }");
  }

  let upstream: Response | null;
  try {
    upstream = await runInvestigation(
      { campaignId, from, to, ...(typeof model === "string" && { model }) },
      request.signal,
    );
  } catch (err) {
    if (err instanceof ApiError) return fail(502, err.code, err.message);
    throw err;
  }
  if (!upstream) return fail(401, "UNAUTHORIZED", "Your session ended. Sign in again.");

  if (!upstream.ok || !upstream.body) return passError(upstream);
  return ndjsonResponse(upstream.body);
}
