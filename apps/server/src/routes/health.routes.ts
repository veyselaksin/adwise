import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { healthController } from "../controllers/health.controller.js";
import { SuccessResponse } from "../schemas/common.schema.js";
import { Health } from "../schemas/health.schema.js";

const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = healthController();

  app.get(
    "/health",
    {
      config: { rateLimit: false },
      schema: {
        tags: ["health"],
        summary: "Health check",
        description: "Returns `ok` when the API process is up. Public, not rate limited; used by the host and the web app.",
        response: { 200: SuccessResponse(Health, { title: "HealthResponse", message: "Service is healthy" }) },
      },
    },
    async () => controller.check(),
  );
};

export default healthRoutes;
