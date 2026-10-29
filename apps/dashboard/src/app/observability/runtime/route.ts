import { ApiError, getRuntime } from "@lib/api";

/** GET /observability/runtime → the API process's runtime snapshot, for the Runtime tab's refresh. Session required (proxy + API). */
export async function GET() {
  try {
    return Response.json(await getRuntime(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ success: false, message: err.message, error: { code: err.code } }, { status: 502 });
    }
    throw err;
  }
}
