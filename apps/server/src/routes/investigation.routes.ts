import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { INVESTIGATION_MAX_DAYS, INVESTIGATION_RATE_LIMIT, MIN_SUBSCRIPTIONS } from "../constants/investigation.constant.js";
import { investigationController } from "../controllers/investigation.controller.js";
import { ErrorRef } from "../schemas/common.schema.js";
import { InvestigationBody } from "../schemas/investigation.schema.js";

const investigationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = investigationController(app.services, app.config.AGENT_MODEL);
  app.addHook("onRequest", app.authenticate);

  app.post(
    "/investigations",
    {
      config: { rateLimit: { max: INVESTIGATION_RATE_LIMIT, timeWindow: "1 minute" } },
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["investigations"],
        summary: "Investigate a campaign's performance change",
        description: [
          `Compares one campaign's period (\`from\`–\`to\`, at most ${INVESTIGATION_MAX_DAYS} days) with the same number of days just before it. Every figure comes from the metric layer (the dashboard's own definitions and maturity rules); the model only interprets them. Its findings must cite evidence ids from the facts, and statements with money or percentage figures that aren't in the facts are removed.`,
          "",
          "**The 200 response is a stream** (`application/x-ndjson`), one JSON event per line:",
          "- `stage` `{ key, label, status }`: progress through `validate`, `current`, `previous`, `breakdown`, `releases`, `interpret` (`running`, `done` or `skipped`)",
          `- \`facts\` \`{ facts }\`: the verified report: metric comparisons (previous, current, absolute and % change, provisional flags), CAC split into funnel steps, ad set and ad movers, daily rows, releases in the two periods, limitations. \`status: "insufficient"\` when the campaign had no spend in either period. Small samples (< ${MIN_SUBSCRIPTIONS} subscriptions) are flagged.`,
          "- `interpretation` `{ interpretation }`: summary, ranked findings (`verified` or `hypothesis`, with evidence ids), release notes, next steps, extra limitations, and how many statements the guardrails removed",
          "- `error` `{ code, message, retryAfterSeconds? }`: `AGENT_DISABLED`, `RATE_LIMITED`, `QUOTA_EXHAUSTED`, `MODEL_UNAVAILABLE`, `MODEL_ERROR`, `MODEL_BLOCKED`, `MALFORMED_RESPONSE`, `AGENT_FAILED` or `FACTS_FAILED`. Facts sent before an error stay valid.",
          "- `done` `{ model, usage }`: always last; `model` is null when no model was called",
          "",
          "Errors before the stream (bad dates, a period or its previous period outside the data, unknown campaign) use the normal error envelope.",
        ].join("\n"),
        body: InvestigationBody,
        response: { 400: ErrorRef, 401: ErrorRef, 404: ErrorRef, 429: ErrorRef },
      },
    },
    async (req, reply) => controller.run(req.body, reply),
  );
};

export default investigationRoutes;
