import type { NextRequest } from "next/server";
import { ApiError, fetchCreativeImage } from "@lib/api";
import { fail, passError } from "@lib/ndjson";

const ID = /^[0-9a-f-]{36}$/;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * GET /creatives/:id/image[?download=1] → the creative's image, passed through
 * from the API so the token stays on the server. Private and never cached:
 * only the account that generated it can load it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/creatives/[id]/image">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return fail(404, "CREATIVE_NOT_FOUND", "No creative with that id");
  const download = request.nextUrl.searchParams.get("download") === "1";

  let upstream: Response | null;
  try {
    upstream = await fetchCreativeImage(id, download);
  } catch (err) {
    if (err instanceof ApiError) return fail(502, err.code, err.message);
    throw err;
  }
  if (!upstream) return fail(401, "UNAUTHORIZED", "Your session ended. Sign in again.");
  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !upstream.body || !IMAGE_TYPES.has(type)) return passError(upstream);

  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
    },
  });
}
