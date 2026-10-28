import type { FastifyError } from "fastify";
import fp from "fastify-plugin";
import { failure } from "../lib/response.js";

/** Maps every error to the failure envelope; 5xx details stay in the logs. */
export default fp(
  async (app) => {
    app.setErrorHandler((err: FastifyError, req, reply) => {
      const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;

      if (status >= 500) {
        req.log.error({ err }, "Unhandled error");
        return reply.code(status).send(failure("INTERNAL_ERROR", "Something went wrong"));
      }

      const code = err.validation ? "VALIDATION_ERROR" : (err.code ?? "BAD_REQUEST");
      return reply.code(status).send(failure(code, err.message));
    });

    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send(failure("NOT_FOUND", `Route ${req.method} ${req.url} not found`)),
    );
  },
  { name: "error-handler" },
);
