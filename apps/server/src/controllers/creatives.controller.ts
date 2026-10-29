import type { FastifyReply } from "fastify";
import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { AgentModelId } from "../types/agent.type.js";
import type { BriefSuggestRequest, ConceptsRequest, CreativeChanges, CreativeListQuery, CreativeSource, GenerateRequest } from "../types/creatives.type.js";

/** `user` is the signed-in account (the JWT subject); creatives are private to it. */
export const creativesController = ({ creatives }: Services, defaultModel: AgentModelId) => ({
  config: () => success(creatives.config(), "Studio settings loaded"),
  context: async (query: CreativeSource) => success(await creatives.context(query), "Performance context loaded"),

  concepts: async (body: ConceptsRequest, reply: FastifyReply) => {
    const result = await creatives.concepts(body, { model: body.model ?? defaultModel, signal: abortOnClose(reply), requestId: reply.request.id });
    return success(result, result.dataInformed ? "Concepts generated from measured performance" : "Exploratory concepts generated");
  },

  brief: async (body: BriefSuggestRequest, reply: FastifyReply) => {
    const result = await creatives.suggestBrief(body, { model: body.model ?? defaultModel, signal: abortOnClose(reply), requestId: reply.request.id });
    return success(result, result.suggestions.length ? "Brief suggestions generated" : "No suggestions survived the guardrails");
  },

  generate: async (body: GenerateRequest, user: string, requestId: string) => {
    const result = await creatives.generate(body, user, requestId);
    const made = result.creatives.filter((c) => c.status === "succeeded").length;
    const message = result.replayed
      ? "Already generated for this request; no new image was requested"
      : made === result.requested
        ? made === 1
          ? "Image generated"
          : `${made} images generated`
        : `${made} of ${result.requested} images generated; the rest failed`;
    return success(result, message);
  },

  list: (query: CreativeListQuery, user: string) => success(creatives.list(query, user), "Creatives loaded"),
  get: (id: string, user: string) => success(creatives.get(id, user), "Creative loaded"),
  edit: async (id: string, changes: CreativeChanges, user: string) => success(await creatives.edit(id, changes, user), "Creative updated"),
  remove: async (id: string, user: string) => success(await creatives.remove(id, user), "Creative deleted"),

  image: async (id: string, download: boolean, user: string, reply: FastifyReply) => {
    const file = await creatives.image(id, user);
    return reply
      .type(file.mimeType)
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `${download ? "attachment" : "inline"}; filename="${file.filename}"`)
      .send(file.bytes);
  },
});

/** Stops a text-model call when the user leaves; nothing per-image is billed on these routes. */
function abortOnClose(reply: FastifyReply): AbortSignal {
  const abort = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) abort.abort();
  });
  return abort.signal;
}
