import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { AGENT_MAX_QUESTION_CHARS, AGENT_MODELS } from "../constants/agent.constant.js";
import { success } from "../lib/response.js";
import { AppError } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { AgentModelId, ChatMessage } from "../types/agent.type.js";

export const agentController = ({ agent }: Services, defaultModel: AgentModelId) => ({
  models: () =>
    success(
      { default: defaultModel, models: AGENT_MODELS.map(({ id, label, description }) => ({ id, label, description })) },
      "Models loaded",
    ),

  /** Streams the agent's steps and answer as NDJSON: one `AgentEvent` per line, ending with `done`. */
  chat: async (body: { messages: ChatMessage[]; model?: AgentModelId }, reply: FastifyReply) => {
    if (!agent) {
      throw new AppError(503, "AGENT_DISABLED", "The agent is off: ZENMUX_API_KEY isn't set on the server.");
    }
    agent.validate(body.messages);
    if (body.messages.at(-1)!.text.length > AGENT_MAX_QUESTION_CHARS) {
      throw new AppError(400, "QUESTION_TOO_LONG", `Keep questions under ${AGENT_MAX_QUESTION_CHARS} characters`);
    }

    // Stop calling the model when the user closes the panel or presses stop.
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    async function* lines() {
      for await (const event of agent!.chat(body.messages, { model: body.model ?? defaultModel, signal: abort.signal, requestId: reply.request.id })) yield `${JSON.stringify(event)}\n`;
    }
    return reply
      .type("application/x-ndjson; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-accel-buffering", "no")
      .send(Readable.from(lines()));
  },
});
