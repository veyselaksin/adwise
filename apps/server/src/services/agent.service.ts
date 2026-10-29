import type { FastifyBaseLogger } from "fastify";
import { ModelError } from "../clients/zenmux.client.js";
import { AGENT_MAX_FOLLOW_UPS, AGENT_MAX_STEPS, AGENT_MODELS, AGENT_RECENT_MESSAGES } from "../constants/agent.constant.js";
import { SNAPSHOT_EARLIER_QUESTIONS, SNAPSHOT_MAX_EVIDENCE_BYTES } from "../constants/insights.constant.js";
import { AppError } from "../lib/response.js";
import type { SnapshotSigner } from "../lib/snapshot.js";
import type { AgentEvent, AgentModelId, ChatMessage, ModelClient, ModelMessage, ModelUsage } from "../types/agent.type.js";
import type { Evidence, Snapshot } from "../types/insights.type.js";
import { buildSystemPrompt } from "./agent.prompt.js";
import { runTool, TOOL_DECLARATIONS, toolLabel, type ToolDeps, type ToolOutput } from "./agent.tools.js";
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
    private readonly snapshots: SnapshotSigner,
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

  async *chat(messages: ChatMessage[], opts: { model: AgentModelId; signal?: AbortSignal }): AsyncGenerator<AgentEvent> {
    const { model, signal } = opts;
    const history = toMessages(messages);
    // Built per question, so a rule added on the Rules page applies from the next question.
    const system = buildSystemPrompt(this.deps.metrics.catalog(), this.knowledge, this.rules.active());
    const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    // What the answer rests on, kept for the snapshot an insight is saved from.
    const evidence: Evidence[] = [];
    const notes: string[] = [];
    let steps = 0;

    try {
      while (steps < AGENT_MAX_STEPS) {
        steps++;
        // The last step may not call tools, so every question ends in an answer.
        const stream = this.model.stream({
          model,
          system,
          messages: history,
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
        const { message, usage: used } = next.value;
        usage.inputTokens += used.inputTokens;
        usage.outputTokens += used.outputTokens;
        history.push(message);

        const calls = message.tool_calls ?? [];
        const text = (message.content ?? "").trim();
        if (calls.length === 0) {
          if (!text) throw new ModelError("MODEL_ERROR", "The model returned an empty answer. Try rephrasing the question.");
          const { answer, followUps } = splitFollowUps(text);
          yield { type: "answer", text: answer };
          if (followUps.length > 0) yield { type: "follow_ups", questions: followUps };
          yield { type: "snapshot", token: this.snapshots.sign(this.snapshot(messages, answer, notes, evidence, model)) };
          break;
        }
        if (text) {
          const note = splitFollowUps(text).answer;
          notes.push(note);
          yield { type: "note", text: note };
        }

        const ids = calls.map((_, i) => `${steps}.${i + 1}`);
        const args = calls.map((call) => parseArgs(call.function.arguments));
        for (const [i, call] of calls.entries()) {
          yield { type: "tool_call", id: ids[i]!, tool: call.function.name, label: toolLabel(call.function.name, args[i] ?? {}), args: args[i] ?? {} };
        }
        const outputs: ToolOutput[] = await Promise.all(
          calls.map((call, i) =>
            args[i]
              ? runTool(call.function.name, args[i], this.deps)
              : { ok: false, summary: "Invalid arguments", data: { error: "Arguments must be a JSON object" } },
          ),
        );
        for (const [i, call] of calls.entries()) {
          const out = outputs[i]!;
          if (!out.ok) this.log.warn({ tool: call.function.name, args: call.function.arguments, error: out.data.error }, "Agent tool call failed");
          yield { type: "tool_result", id: ids[i]!, ok: out.ok, summary: out.summary };
          evidence.push(evidenceOf(ids[i]!, call.function.name, args[i] ?? {}, out));
          if (out.export) yield { type: "export", id: ids[i]!, label: toolLabel(call.function.name, args[i] ?? {}), ...out.export };
          history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.data) });
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ModelError) {
        this.log.warn({ model, code: err.code, detail: err.detail }, "Agent model call failed");
        yield { type: "error", code: err.code, message: err.message, ...(err.retryAfterSeconds && { retryAfterSeconds: err.retryAfterSeconds }) };
      } else {
        this.log.error({ err, model }, "Agent failed");
        yield { type: "error", code: "AGENT_FAILED", message: "Something went wrong while answering. Try again." };
      }
    }
    yield { type: "done", model, steps, usage };
  }

  private snapshot(messages: ChatMessage[], answer: string, notes: string[], evidence: Evidence[], model: AgentModelId): Snapshot {
    const questions = messages.filter((m) => m.role === "user").map((m) => m.text.trim());
    return {
      v: 1,
      answeredAt: new Date().toISOString(),
      question: questions.at(-1)!,
      earlierQuestions: questions.slice(0, -1).slice(-SNAPSHOT_EARLIER_QUESTIONS),
      answer,
      notes,
      model: { id: model, label: AGENT_MODELS.find((m) => m.id === model)?.label ?? model },
      dataToday: this.deps.metrics.catalog().today,
      evidence,
    };
  }
}

/** A lookup as the model read it; a very large output keeps only its summary. */
function evidenceOf(id: string, tool: string, args: Record<string, unknown>, out: ToolOutput): Evidence {
  const base = { id, tool, label: toolLabel(tool, args), args, ok: out.ok, summary: out.summary };
  return Buffer.byteLength(JSON.stringify(out.data)) > SNAPSHOT_MAX_EVIDENCE_BYTES
    ? { ...base, data: null, truncated: true }
    : { ...base, data: out.data };
}

/**
 * Separates the hidden follow-up block the prompt asks for from the answer, so
 * the answer (and the history the dashboard sends back) stays clean.
 */
export function splitFollowUps(text: string): { answer: string; followUps: string[] } {
  const match = /<!--\s*follow-ups\b([\s\S]*?)(?:-->|$)/i.exec(text);
  if (!match) return { answer: text, followUps: [] };
  const followUps = match[1]!
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((q) => q.length > 0 && q.length <= 200)
    .slice(0, AGENT_MAX_FOLLOW_UPS);
  const answer = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  return { answer: answer || text, followUps };
}

/** The model's tool arguments, a JSON string; null when they aren't a JSON object. */
function parseArgs(json: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(json || "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The conversation as model input. Recent messages go in verbatim; older ones
 * shrink to the question and the answer's lead sentence (the team's answers
 * lead with the answer), so long chats keep working at a flat cost. Tool
 * results from earlier questions are never resent.
 */
export function toMessages(messages: ChatMessage[]): ModelMessage[] {
  const recent = messages.slice(-AGENT_RECENT_MESSAGES);
  const older = messages.slice(0, Math.max(0, messages.length - AGENT_RECENT_MESSAGES));
  const out: ModelMessage[] = [];

  if (older.length > 0) {
    const digest = older
      .map((m) => (m.role === "user" ? `Q: ${clip(m.text, 300)}` : `A: ${leadSentence(m.text)}`))
      .join("\n");
    out.push({ role: "user", content: `Earlier in this conversation (shortened):\n${digest}` });
  }
  for (const m of recent) {
    const last = out.at(-1);
    // Some providers expect turns to alternate; merge neighbours from the same side.
    if (last && last.role === m.role) last.content = `${last.content ?? ""}\n\n${m.text}`;
    else out.push(m.role === "user" ? { role: "user", content: m.text } : { role: "assistant", content: m.text });
  }
  return out;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function leadSentence(text: string): string {
  const plain = text.replace(/\*\*|__|`/g, "").trim();
  const end = plain.search(/[.!?](\s|$)/);
  return clip(end === -1 ? plain.split("\n")[0]! : plain.slice(0, end + 1), 300);
}
