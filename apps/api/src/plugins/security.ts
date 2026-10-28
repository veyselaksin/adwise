import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

/** HTTP hardening: secure headers, CORS locked to the web app, global rate limit. */
export default fp(
  async (app) => {
    await app.register(helmet, {
      // Swagger UI ships inline scripts/styles; it is protected by its own auth instead.
      contentSecurityPolicy: false,
    });

    await app.register(cors, {
      origin: app.config.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    });

    await app.register(rateLimit, {
      max: 300,
      timeWindow: "1 minute",
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Try again in ${ctx.after}.`,
        },
      }),
    });
  },
  { name: "security" },
);
