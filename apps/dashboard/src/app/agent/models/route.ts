import { ApiError, getAgentModels } from "@lib/api";

/** GET /agent/models → the models the agent panel offers, and the default. */
export async function GET() {
  try {
    return Response.json(await getAgentModels(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ success: false, message: err.message, error: { code: err.code } }, { status: 502 });
    }
    throw err;
  }
}
