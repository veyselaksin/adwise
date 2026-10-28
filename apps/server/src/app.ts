import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";
import type { Env } from "./config/env.js";
import auth from "./plugins/auth.js";
import data from "./plugins/data.js";
import errorHandler from "./plugins/error-handler.js";
import security from "./plugins/security.js";
import swagger from "./plugins/swagger.js";
import authRoutes from "./routes/auth.js";
import health from "./routes/health.js";
import metrics from "./routes/metrics.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
  }
}

export async function buildApp(env: Env, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
    },
    trustProxy: true,
    ...opts,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(
    fp(
      async (instance) => {
        instance.decorate("config", env);
      },
      { name: "config" },
    ),
  );
  await app.register(errorHandler);
  await app.register(security);
  await app.register(auth);
  await app.register(swagger);
  await app.register(data);

  await app.register(health);
  await app.register(authRoutes);
  await app.register(metrics);

  return app;
}
