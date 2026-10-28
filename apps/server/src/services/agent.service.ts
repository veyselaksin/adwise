import type { FastifyBaseLogger } from "fastify";
import { ModelError } from "../clients/gemini.client.js";
import { AGENT_MAX_STEPS, AGENT_RECENT_MESSAGES } from "../constants/agent.constant.js";
import { AppError } from "../lib/response.js";
import type { AgentEvent, ChatMessage, ModelClient, ModelContent, ModelPart, ModelUsage } from "../types/agent.type.js";
import { buildSystemPrompt } from "./agent.prompt.js";
import { runTool, TOOL_DECLARATIONS, toolLabel, type ToolDeps } from "./agent.tools.js";
import type { KnowledgeService } from "./knowledge.service.js";
import type { RulesService } from "./rules.service.js";

/**
 * Answers a question with a short tool loop: the model asks for data, the
 * tools read it through the same services as the dashboard, and every step is
 * streamed so the user sees what's happening. The server keeps no chat state;
 * the dashboard sends the conversation each time.
 */
export class AgentService {
  constructor(
    private readonly model: ModelClient,
    private readonly deps: ToolDeps,
    private readonly knowledge: KnowledgeService,
    private readonly rules: RulesService,
    private readonly log: Pick<FastifyBaseLogger, "warn" | "error">,
  ) {}

  /** Throws before anything is streamed, so bad input still gets a normal 400. */
  validate(messages: ChatMessage[]): void {
    if (messages.at(-1)?.role !== "user") {
      throw new AppError(400, "LAST_MESSAGE_NOT_USER", "The last message must be the user's question");
    }
    if (!messages.at(-1)!.text.trim()) {
      throw new AppError(400, "EMPTY_QUESTION", "The question is empty");
    }
  }

  async *chat(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const contents = toContents(messages);
    // Built per question, so a rule added on the Rules page applies from the next question.
    const system = buildSystemPrompt(this.deps.metrics.catalog(), this.knowledge, this.rules.active());
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    let steps = 0;

    try {
      while (steps < AGENT_MAX_STEPS) {
        steps++;
        // The last step may not call tools, so every question ends in an answer.
        const stream = this.model.stream({
          system,
          contents,
          tools: TOOL_DECLARATIONS,
          allowTools: steps < AGENT_MAX_STEPS,
          signal,
        });
        // Text streams as it's written; whether it was the answer or a remark
        // before a lookup is only known at the end of the step (`answer` or `note`).
        let next = await stream.next();
        while (!next.done) {
          yield { type: "text_delta", text: next.value };
          next = await stream.next();
        }
        const res = next.value;
        usage.inputTokens += res.usage.inputTokens;
        usage.outputTokens += res.usage.outputTokens;
        contents.push(res.content);

        const calls = res.content.parts.flatMap((p) => (p.functionCall ? [p.functionCall] : []));
        const text = res.content.parts
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text)
          .join("")
          .trim();

        if (calls.length === 0) {
          if (!text) throw new ModelError("MODEL_ERROR", "The model returned an empty answer. Try rephrasing the question.");
          yield { type: "answer", text };
          break;
        }
        if (text) yield { type: "note", text };

        const ids = calls.map((_, i) => `${steps}.${i + 1}`);
        for (const [i, call] of calls.entries()) {
          yield { type: "tool_call", id: ids[i]!, tool: call.name, label: toolLabel(call.name, call.args ?? {}), args: call.args ?? {} };
        }
        const outputs = await Promise.all(calls.map((call) => runTool(call.name, call.args ?? {}, this.deps)));
        const responses: ModelPart[] = [];
        for (const [i, call] of calls.entries()) {
          const out = outputs[i]!;
          if (!out.ok) this.log.warn({ tool: call.name, args: call.args, error: out.data.error }, "Agent tool call failed");
          yield { type: "tool_result", id: ids[i]!, ok: out.ok, summary: out.summary };
          responses.push({ functionResponse: { ...(call.id && { id: call.id }), name: call.name, response: out.data } });
        }
        contents.push({ role: "user", parts: responses });
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ModelError) {
        this.log.warn({ code: err.code, detail: err.detail }, "Agent model call failed");
        yield { type: "error", code: err.code, message: err.message, ...(err.retryAfterSeconds && { retryAfterSeconds: err.retryAfterSeconds }) };
      } else {
        this.log.error({ err }, "Agent failed");
        yield { type: "error", code: "AGENT_FAILED", message: "Something went wrong while answering. Try again." };
      }
    }
    yield { type: "done", steps, usage };
  }
}

/**
 * The conversation as model input. Recent messages go in verbatim; older ones
 * shrink to the question and the answer's lead sentence (the team's answers
 * lead with the answer), so long chats keep working at a flat cost. Tool
 * results from earlier questions are never resent.
 */
export function toContents(messages: ChatMessage[]): ModelContent[] {
  const recent = messages.slice(-AGENT_RECENT_MESSAGES);
  const older = messages.slice(0, Math.max(0, messages.length - AGENT_RECENT_MESSAGES));
  const contents: ModelContent[] = [];

  if (older.length > 0) {
    const digest = older
      .map((m) => (m.role === "user" ? `Q: ${clip(m.text, 300)}` : `A: ${leadSentence(m.text)}`))
      .join("\n");
    contents.push({ role: "user", parts: [{ text: `Earlier in this conversation (shortened):\n${digest}` }] });
  }
  for (const m of recent) {
    const role = m.role === "user" ? "user" : "model";
    const last = contents.at(-1);
    // Gemini expects turns to alternate; merge neighbours from the same side.
    if (last?.role === role) last.parts.push({ text: m.text });
    else contents.push({ role, parts: [{ text: m.text }] });
  }
  return contents;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function leadSentence(text: string): string {
  const plain = text.replace(/\*\*|__|`/g, "").trim();
  const end = plain.search(/[.!?](\s|$)/);
  return clip(end === -1 ? plain.split("\n")[0]! : plain.slice(0, end + 1), 300);
}
