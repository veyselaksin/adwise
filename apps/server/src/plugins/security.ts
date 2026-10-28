import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import { AppError } from "../lib/response.js";

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
      // The returned value is thrown, so it goes through the error handler.
      errorResponseBuilder: (_req, ctx) =>
        new AppError(429, "RATE_LIMITED", `Too many requests. Try again in ${ctx.after}.`),
    });
  },
  { name: "security" },
);
