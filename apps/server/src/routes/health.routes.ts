import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { version } from "../config/version.js";
import { success } from "../lib/response.js";
import { SuccessResponse } from "../schemas/common.js";

const Health = Type.Object({
  status: Type.Literal("ok"),
  uptime: Type.Number({ description: "Process uptime in seconds", examples: [11.03] }),
  version: Type.String({ description: "API version", examples: ["v0.1.0"] }),
});

const HealthResponse = SuccessResponse(Health, {
  title: "HealthResponse",
  message: "Service is healthy",
});

const health: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/health",
    {
      config: { rateLimit: false },
      schema: {
        tags: ["health"],
        summary: "Health check",
        description: "Returns `ok` when the API process is up. Public, not rate limited; used by the host and the web app.",
        response: { 200: HealthResponse },
      },
    },
    async () =>
      success(
        { status: "ok" as const, uptime: Math.round(process.uptime() * 100) / 100, version: `v${version}` },
        "Service is healthy",
      ),
  );
};

export default health;
