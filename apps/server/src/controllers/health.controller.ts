import { version } from "../config/version.js";
import { success } from "../lib/response.js";
import type { Health } from "../types/health.type.js";

export const healthController = () => ({
  check: () =>
    success<Health>(
      { status: "ok", uptime: Math.round(process.uptime() * 100) / 100, version: `v${version}` },
      "Service is healthy",
    ),
});
