import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

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
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "Missing or invalid access token" },
        });
      }
    });
  },
  { name: "auth", dependencies: ["config"] },
);
