import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AGENT_MAX_STEPS, AGENT_RATE_LIMIT } from "../constants/agent.constant.js";
import { agentController } from "../controllers/agent.controller.js";
import { AgentModels, ChatBody } from "../schemas/agent.schema.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";

const agentRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = agentController(app.services, app.config.AGENT_MODEL);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/agent/models",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["agent"],
        summary: "Models the agent can use",
        description: "The models offered in the agent panel (ZenMux ids) and which one answers when a request names none.",
        response: {
          200: SuccessResponse(AgentModels, { title: "AgentModelsResponse", message: "Models loaded" }),
          401: ErrorRef,
        },
      },
    },
    async () => controller.models(),
  );

  app.post(
    "/agent/chat",
    {
      config: { rateLimit: { max: AGENT_RATE_LIMIT, timeWindow: "1 minute" } },
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["agent"],
        summary: "Ask the agent",
        description: [
          "Answers the last message with the chosen `model` (default from GET /agent/models), using the metrics, entities, budget pacing and build logs, following the team's glossary and notes.",
          "",
          "**The 200 response is a stream** (`application/x-ndjson`), one JSON event per line:",
          "- `tool_call` `{ id, tool, label, args }` and `tool_result` `{ id, ok, summary }`: each data lookup, as it happens",
          "- `text_delta` `{ text }`: text as the model writes it; the step then ends with `answer` or `note` carrying the whole text",
          "- `note` `{ text }`: the model's interim remark before more lookups",
          "- `answer` `{ text }`: the final answer, Markdown",
          "- `error` `{ code, message, retryAfterSeconds? }`: `RATE_LIMITED`, `QUOTA_EXHAUSTED`, `MODEL_UNAVAILABLE`, `MODEL_ERROR`, `MODEL_BLOCKED` or `AGENT_FAILED`",
          "- `done` `{ model, steps, usage: { inputTokens, outputTokens } }`: always last",
          "",
          `At most ${AGENT_MAX_STEPS} model calls per question; the last one must answer. Older messages are shortened to keep the cost per question flat. Limited to ${AGENT_RATE_LIMIT} questions a minute.`,
        ].join("\n"),
        body: ChatBody,
        response: { 400: ErrorRef, 401: ErrorRef, 429: ErrorRef, 503: ErrorRef },
      },
    },
    async (req, reply) => controller.chat(req.body, reply),
  );
};

export default agentRoutes;
