import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import agentRoutes from "./agent.routes.js";
import authRoutes from "./auth.routes.js";
import budgetsRoutes from "./budgets.routes.js";
import entitiesRoutes from "./entities.routes.js";
import healthRoutes from "./health.routes.js";
import mcpRoutes from "./mcp.routes.js";
import metricsRoutes from "./metrics.routes.js";
import rulesRoutes from "./rules.routes.js";

/** Every route plugin. Each is encapsulated, so an auth hook in one doesn't leak into the others. */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(metricsRoutes);
  await app.register(entitiesRoutes);
  await app.register(budgetsRoutes);
  await app.register(agentRoutes);
  await app.register(rulesRoutes);
  await app.register(mcpRoutes);
};

export default routes;
