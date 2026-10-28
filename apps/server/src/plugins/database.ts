import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import fp from "fastify-plugin";
import { Metrics } from "../metrics/query.js";

declare module "fastify" {
  interface FastifyInstance {
    metrics: Metrics;
  }
}

/**
 * Opens the ad data read-only and exposes it as `app.metrics`. Fails at boot
 * when the file is missing, rather than on the first request.
 */
export default fp(
  async (app) => {
    const path = app.config.DB_PATH;
    if (!existsSync(path)) {
      throw new Error(`DB_PATH does not exist: ${path}`);
    }
    const db = new DatabaseSync(path, { readOnly: true });
    app.decorate("metrics", new Metrics(db));
    app.addHook("onClose", async () => db.close());
  },
  { name: "data", dependencies: ["config"] },
);
