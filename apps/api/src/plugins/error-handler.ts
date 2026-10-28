import type { FastifyError } from "fastify";
import fp from "fastify-plugin";

/** Maps every error to the ErrorResponse envelope; 5xx details stay in the logs. */
export default fp(
  async (app) => {
    app.setErrorHandler((err: FastifyError, req, reply) => {
      const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

      if (status >= 500) {
        req.log.error({ err }, "Unhandled error");
        return reply.code(status).send({
          error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
        });
      }

      if (status === 401 && reply.getHeader("www-authenticate")) {
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "Authentication required" },
        });
      }

      const code = err.validation ? "VALIDATION_ERROR" : (err.code ?? "BAD_REQUEST");
      return reply.code(status).send({ error: { code, message: err.message } });
    });

    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send({
        error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` },
      }),
    );
  },
  { name: "error-handler" },
);
