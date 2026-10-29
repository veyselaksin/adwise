import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";
import type { Env } from "./config/env.js";
import auth from "./plugins/auth.js";
import database from "./plugins/database.js";
import { LogSink } from "./lib/log-sink.js";
import errorHandler from "./plugins/error-handler.js";
import security from "./plugins/security.js";
import services, { type ServicesOptions } from "./plugins/services.js";
import swagger from "./plugins/swagger.js";
import telemetry from "./plugins/telemetry.js";
import routes from "./routes/index.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
  }
}

export async function buildApp(env: Env, { logger, ...opts }: FastifyServerOptions = {}, overrides: ServicesOptions = {}) {
  // Persists warn/error lines (and info lines that name a component) once the telemetry store is open.
  const logSink = new LogSink();
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      hooks: { logMethod: logSink.hook() },
      ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
      // e.g. a discarding stream in tests that read persisted logs
      ...(typeof logger === "object" && logger),
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
  await app.register(database);
  await app.register(telemetry, { logSink, store: overrides.telemetryStore });
  await app.register(services, overrides);

  await app.register(routes);

  return app;
}
