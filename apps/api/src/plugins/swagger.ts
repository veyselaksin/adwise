import { timingSafeEqual } from "node:crypto";
import basicAuth from "@fastify/basic-auth";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import { ErrorResponse } from "../schemas/common.js";
import { version } from "../config/version.js";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const description = `
REST API behind the Livensa ad performance dashboard and its AI agent.

**Authentication**
- Data endpoints require a JWT: click **Authorize** and paste the token as \`Bearer <token>\`.
- These docs are protected with HTTP Basic auth (\`DOCS_USER\` / \`DOCS_PASSWORD\`).

**Conventions**
- Money is USD, dates are \`YYYY-MM-DD\` (UTC).
- Errors always use the \`ErrorResponse\` envelope: \`{ "error": { "code", "message" } }\`.
- Requests are rate limited; over the limit you get \`429 RATE_LIMITED\`.
`.trim();

/** OpenAPI spec generated from route schemas, served at /docs behind Basic auth. */
export default fp(
  async (app) => {
    // Registered before routes so every schema that references it resolves.
    app.addSchema(ErrorResponse);

    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: { title: "Ad Performance API", version, description },
        servers: [{ url: "/", description: "Current host" }],
        tags: [{ name: "health", description: "Liveness and version checks" }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description: "Session token issued by the login endpoint",
            },
          },
        },
      },
    });

    if (!app.config.DOCS_ENABLED) return;

    await app.register(basicAuth, {
      authenticate: { realm: "Ad Performance API docs" },
      validate: async (username, password) => {
        const ok =
          safeEqual(username, app.config.DOCS_USER) &&
          safeEqual(password, app.config.DOCS_PASSWORD);
        if (!ok) throw new Error("Invalid docs credentials");
      },
    });

    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true, persistAuthorization: true },
      uiHooks: { onRequest: app.basicAuth },
      staticCSP: true,
    });
  },
  { name: "swagger", dependencies: ["config"] },
);
