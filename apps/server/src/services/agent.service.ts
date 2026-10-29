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
import { classifyRunError, emptyUsage, modelSpanError, type RunOutcome, type TelemetryService, toolSpanResult } from "./telemetry.service.js";

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
    private readonly telemetry: TelemetryService,
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

  async *chat(messages: ChatMessage[], opts: { model: AgentModelId; signal?: AbortSignal; requestId?: string }): AsyncGenerator<AgentEvent> {
    const { model, signal } = opts;
    // Telemetry: one run per question, closed in `finally` however the stream ends.
    const run = this.telemetry.startRun({ kind: "agent", provider: "zenmux", model, requestId: opts.requestId });
    let outcome: RunOutcome | null = null;
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
        const span = run.startSpan("model", `Model call ${steps}`, { model, metadata: { step: steps, toolsAllowed: steps < AGENT_MAX_STEPS } });
        let next;
        try {
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
          next = await stream.next();
          while (!next.done) {
            yield { type: "text_delta", text: next.value };
            next = await stream.next();
          }
        } catch (err) {
          span.end(modelSpanError(err, signal));
          throw err;
        } finally {
          // The stream didn't finish and nothing threw: the client stopped reading mid-stream.
          if (!next?.done) span.end({ status: "cancelled", errorCategory: "CANCELLED" });
        }
        const { message, usage: used } = next.value;
        span.end({
          status: "ok",
          usage: next.value.telemetry ?? reportedUsage(used),
          metadata: { toolCallsRequested: message.tool_calls?.length ?? 0 },
        });
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
          outcome = { status: "success" };
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
          calls.map(async (call, i) => {
            const name = call.function.name;
            const span = run.startSpan("tool", name, {
              tool: name,
              // The step-list label and argument names describe the lookup; results never go to telemetry.
              metadata: { step: steps, label: toolLabel(name, args[i] ?? {}), argKeys: Object.keys(args[i] ?? {}) },
            });
            try {
              const out: ToolOutput = args[i]
                ? await runTool(name, args[i], this.deps)
                : { ok: false, code: "INVALID_ARGUMENTS", summary: "Invalid arguments", data: { error: "Arguments must be a JSON object" } };
              span.end(toolSpanResult(out));
              return out;
            } catch (err) {
              span.end({ status: "error", errorCategory: "TOOL_EXCEPTION", errorMessage: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
              throw err;
            }
          }),
        );
        for (const [i, call] of calls.entries()) {
          const out = outputs[i]!;
          if (!out.ok) {
            this.log.warn(
              { component: "agent", ...run.ids, tool: call.function.name, errorCategory: out.code, argKeys: Object.keys(args[i] ?? {}), error: out.data.error },
              "Agent tool call failed",
            );
          }
          yield { type: "tool_result", id: ids[i]!, ok: out.ok, summary: out.summary };
          evidence.push(evidenceOf(ids[i]!, call.function.name, args[i] ?? {}, out));
          if (out.export) yield { type: "export", id: ids[i]!, label: toolLabel(call.function.name, args[i] ?? {}), ...out.export };
          history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.data) });
        }
      }
      // Only reachable if the forced last step still returned tool calls.
      outcome ??= { status: "failure", errorCategory: "NO_ANSWER", errorMessage: `No answer after ${steps} model calls` };
    } catch (err) {
      outcome = classifyRunError(err, signal);
      if (signal?.aborted) return;
      if (err instanceof ModelError) {
        this.log.warn({ component: "agent", ...run.ids, model, code: err.code, detail: err.detail }, "Agent model call failed");
        yield { type: "error", code: err.code, message: err.message, ...(err.retryAfterSeconds && { retryAfterSeconds: err.retryAfterSeconds }) };
      } else {
        this.log.error({ component: "agent", ...run.ids, err, model }, "Agent failed");
        yield { type: "error", code: "AGENT_FAILED", message: "Something went wrong while answering. Try again." };
      }
    } finally {
      // No outcome here means the client stopped reading before the run ended.
      run.finish(outcome ?? { status: "cancelled", errorCategory: "CANCELLED", errorMessage: "The client closed the request." });
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

/** Usage from a client that has no telemetry of its own: its counts are taken as reported. */
const reportedUsage = (used: ModelUsage) => emptyUsage({ inputTokens: used.inputTokens, outputTokens: used.outputTokens });

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
