import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { safeEqual } from "../lib/crypto.js";
import { AppError } from "../lib/response.js";
import type { Services } from "../plugins/services.js";

/**
 * MCP speaks JSON-RPC, so its responses are the protocol's, not our envelope;
 * only the errors before the transport takes over (wrong secret, wrong method) use it.
 */
export const mcpController = ({ mcp }: Services, secret: string) => {
  /** A wrong secret looks like any unknown route, so the path can't be probed. */
  const check = (given: string) => {
    if (!safeEqual(given, secret)) throw new AppError(404, "NOT_FOUND", "Route not found");
  };

  return {
    /** One JSON-RPC message, answered by a fresh stateless server (no sessions, plain JSON back). */
    handle: async (given: string, req: FastifyRequest, reply: FastifyReply) => {
      check(given);
      const server = mcp.server();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(req.raw, reply.raw, req.body);
    },

    /** Stateless: there is no event stream to open (GET) and no session to end (DELETE). */
    notAllowed: (given: string) => {
      check(given);
      throw new AppError(405, "METHOD_NOT_ALLOWED", "This MCP endpoint is stateless: send JSON-RPC messages with POST");
    },
  };
};
