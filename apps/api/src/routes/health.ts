import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { version } from "../config/version.js";

const HealthResponse = Type.Object(
  {
    status: Type.Literal("ok"),
    uptime: Type.Number({ description: "Process uptime in seconds", examples: [128.4] }),
    version: Type.String({ description: "API version", examples: ["0.1.0"] }),
  },
  { title: "HealthResponse" },
);

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
    async () => ({ status: "ok" as const, uptime: process.uptime(), version }),
  );
};

export default health;
