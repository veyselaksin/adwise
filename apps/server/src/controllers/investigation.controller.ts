import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import type { Services } from "../plugins/services.js";
import type { AgentModelId } from "../types/agent.type.js";
import type { InvestigationRequest } from "../types/investigation.type.js";

export const investigationController = ({ investigation }: Services, defaultModel: AgentModelId) => ({
  /** Streams the investigation as NDJSON: one `InvestigationEvent` per line, ending with `done`. */
  run: async (body: InvestigationRequest, reply: FastifyReply) => {
    // Validation throws before the stream starts, so bad input gets the normal error envelope.
    const input = await investigation.validate(body);

    // Stop calling the model when the user leaves the page or starts another run.
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    async function* lines() {
      for await (const event of investigation.run(input, { model: body.model ?? defaultModel, signal: abort.signal, requestId: reply.request.id })) {
        yield `${JSON.stringify(event)}\n`;
      }
    }
    return reply
      .type("application/x-ndjson; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-accel-buffering", "no")
      .send(Readable.from(lines()));
  },
});
