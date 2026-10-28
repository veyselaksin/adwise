import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { Platform } from "../types/releases.type.js";

export const releasesController = ({ releases }: Services) => ({
  list: (query: { from?: string; to?: string; platform?: Platform }) =>
    success(releases.list({ range: { from: query.from, to: query.to }, platform: query.platform }), "Releases loaded"),
});
