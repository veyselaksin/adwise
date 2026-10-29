import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { failure } from "../lib/response.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /** The signed-in account; insights record it as their owner. */
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    /** preHandler for protected routes: `{ onRequest: [app.authenticate] }`. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** JWT session auth. Login routes come later; protected routes reuse `authenticate`. */
export default fp(
  async (app) => {
    await app.register(jwt, {
      secret: app.config.JWT_SECRET,
      sign: { expiresIn: "12h" },
    });

    app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send(failure("UNAUTHORIZED", "Missing or invalid access token"));
      }
    });
  },
  { name: "auth", dependencies: ["config"] },
);
