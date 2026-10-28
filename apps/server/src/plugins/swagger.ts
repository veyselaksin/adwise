import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import { version } from "../config/version.js";
import { ErrorResponse } from "../schemas/common.schema.js";
import { docsThemeCss } from "../views/docs-theme.js";
import docsAuth, { DOCS_PREFIX } from "./docs-auth.js";

const description = `
REST API behind the Livensa ad performance dashboard and its AI agent.

**Authentication**
- Data endpoints require a JWT: get one from \`POST /auth/login\`, then click **Authorize** and paste the token.
- These docs require a sign-in at \`/docs/login\` (\`DOCS_USER\` / \`DOCS_PASSWORD\`); sign out at \`/docs/logout\`.
- Scripts can fetch the spec with HTTP Basic auth, e.g. \`curl -u user:pass /docs/json\`.

**Conventions**
- Money is USD, dates are \`YYYY-MM-DD\` (UTC).
- Every response uses one envelope. Success: \`{ "success": true, "message", "data" }\`. Error (\`ErrorResponse\`): \`{ "success": false, "message", "error": { "code" } }\`.
- Requests are rate limited; over the limit you get \`429 RATE_LIMITED\`.
`.trim();

/** OpenAPI spec generated from route schemas, served at /docs behind a sign-in page. */
export default fp(
  async (app) => {
    // Registered before routes so every schema that references it resolves.
    app.addSchema(ErrorResponse);

    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: { title: "ADWISE API", version, description },
        servers: [{ url: "/", description: "Current host" }],
        tags: [
          { name: "health", description: "Liveness and version checks" },
          { name: "auth", description: "Sign in to get the JWT the data endpoints require" },
          {
            name: "metrics",
            description:
              "Ad performance from the warehouse, read-only. The dashboard and the agent use these same definitions.",
          },
          {
            name: "budgets",
            description: "Ad set spend against daily budgets over a recent window, read-only.",
          },
          {
            name: "rules",
            description: "Answering rules the team adds without a code change; enabled ones go to the agent on every question.",
          },
          {
            name: "agent",
            description: "The AI agent: answers questions from the same services, streaming each step.",
          },
          {
            name: "investigations",
            description:
              "Why a campaign's performance changed: verified period-over-period figures, interpreted by the agent's model under guardrails.",
          },
        ],
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

    await app.register(docsAuth);

    await app.register(swaggerUi, {
      routePrefix: DOCS_PREFIX,
      uiConfig: { docExpansion: "list", deepLinking: true, persistAuthorization: true },
      uiHooks: { onRequest: app.docsGuard },
      staticCSP: true,
      theme: {
        title: "ADWISE API docs",
        css: [{ filename: "overrides.css", content: docsThemeCss }],
      },
    });
  },
  { name: "swagger", dependencies: ["config"] },
);
