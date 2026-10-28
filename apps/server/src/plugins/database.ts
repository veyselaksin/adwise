import fp from "fastify-plugin";
import { type Database, openDatabase } from "../database/connection.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Prisma over the ad data, read-only. Only repositories should query it. */
    db: Database;
  }
}

/** Opens the ad data at boot, so a missing file fails startup rather than the first request. */
export default fp(
  async (app) => {
    const db = openDatabase(app.config.DB_PATH);
    await db.$connect();
    app.decorate("db", db);
    app.addHook("onClose", async () => db.$disconnect());
  },
  { name: "database", dependencies: ["config"] },
);
