import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { MCP_RATE_LIMIT } from "../constants/mcp.constant.js";
import { mcpController } from "../controllers/mcp.controller.js";

/**
 * The agent's tools over MCP (Streamable HTTP) for ChatGPT's connectors, at
 * /mcp/<MCP_SECRET>. Not registered without MCP_SECRET, and hidden from the
 * docs, since the path is the secret.
 */
const mcpRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const secret = app.config.MCP_SECRET;
  if (!secret) return;
  const controller = mcpController(app.services, secret);
  const params = Type.Object({ secret: Type.String() });

  app.post(
    "/mcp/:secret",
    {
      config: { rateLimit: { max: MCP_RATE_LIMIT, timeWindow: "1 minute" } },
      schema: { hide: true, params },
    },
    async (req, reply) => controller.handle(req.params.secret, req, reply),
  );
  for (const method of ["GET", "DELETE"] as const) {
    app.route({
      method,
      url: "/mcp/:secret",
      schema: { hide: true, params },
      handler: async (req) => controller.notAllowed(req.params.secret),
    });
  }
};

export default mcpRoutes;
