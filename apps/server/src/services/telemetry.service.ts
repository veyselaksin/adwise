import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { FastifyBaseLogger } from "fastify";
import { ModelError } from "../clients/zenmux.client.js";
import { MODEL_PRICING } from "../constants/pricing.constant.js";
import { TELEMETRY_INTERNAL } from "../constants/telemetry.constant.js";
import type { SpanRow, TelemetryRepository } from "../database/repositories/telemetry.repository.js";
import { redact, redactString } from "../lib/redact.js";
import { type CallTotals, callCost, runTotals } from "../lib/telemetry-math.js";
import type { AgentModelId } from "../types/agent.type.js";
import type { ModelCallTelemetry, RunKind, RunStatus, SpanKind, SpanStatus } from "../types/telemetry.type.js";

/** The writes the recorder needs; tests swap in one that fails. */
export type TelemetryStore = Pick<TelemetryRepository, "insertRun" | "finishRun" | "insertSpan">;


type Log = Pick<FastifyBaseLogger, "info" | "warn">;

export type RunOutcome = { status: Exclude<RunStatus, "running">; errorCategory?: string | null; errorMessage?: string | null };

export type SpanResult = {
  status: SpanStatus;
  errorCategory?: string | null;
  errorMessage?: string | null;
  /** Model spans: what the provider reported. */
  usage?: ModelCallTelemetry | null;
  metadata?: Record<string, unknown>;
};

/**
 * Records agent and investigation runs: one run row, then a span per model
 * call, tool call or stage, closed with durations from a monotonic clock.
 *
 * Telemetry is best-effort. A failed write is logged (sanitized) and counted,
 * never thrown, so the agent behaves exactly as it would without it. The cost
 * of that choice: a run can be missing or partial in the history when the
 * telemetry file can't be written.
 */
export class TelemetryService {
  private failures = 0;
  private lastFailure: { at: string; message: string } | null = null;

  constructor(
    private readonly store: TelemetryStore,
    private readonly log: Log,
  ) {}

  startRun(input: { kind: RunKind; provider: string; model: string; requestId?: string | null }): RunTrace {
    return new RunTrace(this, input);
  }

  /** Write failures since boot, for the runtime page. */
  health(): { writeFailures: number; lastFailure: { at: string; message: string } | null } {
    return { writeFailures: this.failures, lastFailure: this.lastFailure };
  }

  /** @internal Runs a store write; a failure is reported, not thrown. */
  write(op: string, fn: (store: TelemetryStore) => void): void {
    try {
      fn(this.store);
    } catch (err) {
      this.failures++;
      const message = redactString(err instanceof Error ? `${err.name}: ${err.message}` : String(err), 300);
      this.lastFailure = { at: new Date().toISOString(), message };
      // The first failure and then every 100th, so a broken disk doesn't flood the log.
      if (this.failures === 1 || this.failures % 100 === 0) {
        this.log.warn({ component: "telemetry", op, failures: this.failures, error: message, telemetry: TELEMETRY_INTERNAL }, "Telemetry write failed");
      }
    }
  }

  /** @internal */
  logRun(level: "info" | "warn", fields: Record<string, unknown>, message: string): void {
    this.log[level]({ component: "agent-run", ...fields }, message);
  }
}

/** One run's trace. Every method is safe to call after `finish`: late spans are dropped. */
export class RunTrace {
  readonly runId = randomUUID();
  /** W3C-style ids, so they could be handed to OpenTelemetry later. */
  readonly traceId = randomBytes(16).toString("hex");
  readonly rootSpanId = randomBytes(8).toString("hex");
  readonly startedAt = Date.now();
  private readonly t0 = performance.now();
  private seq = 0;
  private finished = false;
  private readonly calls: CallTotals[] = [];
  private modelDurationMs = 0;
  private toolDurationMs = 0;
  private toolCalls = 0;
  private toolErrors = 0;

  constructor(
    private readonly telemetry: TelemetryService,
    private readonly input: { kind: RunKind; provider: string; model: string; requestId?: string | null },
  ) {
    telemetry.write("insertRun", (s) =>
      s.insertRun({
        run_id: this.runId,
        trace_id: this.traceId,
        root_span_id: this.rootSpanId,
        kind: input.kind,
        started_at: this.startedAt,
        provider: input.provider,
        model: input.model,
        request_id: input.requestId ?? null,
      }),
    );
  }

  /** Correlation fields for log lines about this run. */
  get ids() {
    return { runId: this.runId, traceId: this.traceId };
  }

  /** Opens a span under the run. `end` records it once; later calls are ignored. */
  startSpan(kind: Exclude<SpanKind, "run">, name: string, attrs: { model?: string; tool?: string; metadata?: Record<string, unknown> } = {}) {
    const startedAt = Date.now();
    const t0 = performance.now();
    const seq = ++this.seq;
    const spanId = randomBytes(8).toString("hex");
    let ended = false;

    return {
      spanId,
      end: (result: SpanResult) => {
        if (ended || this.finished) return;
        ended = true;
        const durationMs = performance.now() - t0;
        const usage = result.usage ?? null;
        const cost = kind === "model" && usage ? callCost(usage, MODEL_PRICING[attrs.model as AgentModelId]) : null;

        if (kind === "model") {
          this.modelDurationMs += durationMs;
          this.calls.push({
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            totalTokens: usage?.totalTokens ?? null,
            cachedInputTokens: usage?.cachedInputTokens ?? null,
            reasoningTokens: usage?.reasoningTokens ?? null,
            cost: cost?.cost ?? null,
            costSource: cost?.source ?? null,
            attempts: usage?.attempts ?? null,
          });
        } else if (kind === "tool") {
          this.toolDurationMs += durationMs;
          this.toolCalls++;
          if (result.status === "error") this.toolErrors++;
        }

        const row: SpanRow = {
          span_id: spanId,
          run_id: this.runId,
          trace_id: this.traceId,
          parent_span_id: this.rootSpanId,
          seq,
          kind,
          name: redactString(name, 120),
          status: result.status,
          started_at: startedAt,
          duration_ms: round(durationMs),
          model: attrs.model ?? null,
          tool: attrs.tool ?? null,
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: usage?.outputTokens ?? null,
          total_tokens: usage?.totalTokens ?? null,
          cached_input_tokens: usage?.cachedInputTokens ?? null,
          reasoning_tokens: usage?.reasoningTokens ?? null,
          cost_usd: cost?.cost ?? null,
          cost_source: cost?.source ?? null,
          attempts: usage?.attempts ?? null,
          provider_request_id: usage?.providerRequestId ? redactString(usage.providerRequestId, 100) : null,
          error_category: result.errorCategory ?? null,
          error_message: result.errorMessage ? redactString(result.errorMessage) : null,
          metadata: JSON.stringify(redact({ ...attrs.metadata, ...result.metadata }) ?? {}),
        };
        this.telemetry.write("insertSpan", (s) => s.insertSpan(row));
      },
    };
  }

  /** Closes the run with its totals. Only the first call counts. */
  finish(outcome: RunOutcome): void {
    if (this.finished) return;
    this.finished = true;
    const durationMs = round(performance.now() - this.t0);
    const totals = runTotals(this.calls);
    const errorMessage = outcome.errorMessage ? redactString(outcome.errorMessage) : null;

    this.telemetry.write("finishRun", (s) =>
      s.finishRun(this.runId, {
        status: outcome.status,
        completed_at: this.startedAt + Math.round(durationMs),
        duration_ms: durationMs,
        error_category: outcome.errorCategory ?? null,
        error_message: errorMessage,
        model_call_count: this.calls.length,
        tool_call_count: this.toolCalls,
        tool_error_count: this.toolErrors,
        retry_count: totals.retryCount,
        usage_reported_calls: totals.usageReportedCalls,
        input_tokens: totals.inputTokens,
        output_tokens: totals.outputTokens,
        total_tokens: totals.totalTokens,
        cost_usd: totals.cost,
        cost_source: totals.costSource,
        model_duration_ms: this.calls.length > 0 ? round(this.modelDurationMs) : null,
        tool_duration_ms: this.toolCalls > 0 ? round(this.toolDurationMs) : null,
      }),
    );

    const ok = outcome.status === "success";
    this.telemetry.logRun(
      ok ? "info" : "warn",
      {
        ...this.ids,
        kind: this.input.kind,
        model: this.input.model,
        status: outcome.status,
        durationMs,
        modelCalls: this.calls.length,
        toolCalls: this.toolCalls,
        ...(outcome.errorCategory && { errorCategory: outcome.errorCategory, error: errorMessage }),
      },
      `${this.input.kind === "agent" ? "Agent run" : "Investigation"} ${OUTCOME_WORDS[outcome.status]}`,
    );
  }
}

/**
 * How a run that threw ended: cancelled when the client went away, a timeout
 * when the model didn't finish in time, otherwise a failure with the model's
 * stable code, or INTERNAL_ERROR. Messages are redacted before they're stored.
 */
export function classifyRunError(err: unknown, signal?: AbortSignal): Required<RunOutcome> {
  if (signal?.aborted) return { status: "cancelled", errorCategory: "CANCELLED", errorMessage: "The client closed the request." };
  if (err instanceof ModelError) {
    return {
      status: err.timedOut ? "timeout" : "failure",
      errorCategory: err.timedOut ? "MODEL_TIMEOUT" : err.code,
      errorMessage: err.detail ? `${err.message} Provider: ${err.detail}` : err.message,
    };
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return { status: "timeout", errorCategory: "MODEL_TIMEOUT", errorMessage: "The model response didn't finish in time." };
  }
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { status: "failure", errorCategory: "INTERNAL_ERROR", errorMessage: message };
}

/** Span status and category for a model call that threw. */
export function modelSpanError(err: unknown, signal?: AbortSignal): SpanResult {
  const outcome = classifyRunError(err, signal);
  return {
    status: outcome.status === "cancelled" ? "cancelled" : "error",
    errorCategory: outcome.errorCategory,
    errorMessage: outcome.errorMessage,
    usage: err instanceof ModelError && err.attempts ? emptyUsage({ attempts: err.attempts }) : null,
  };
}

/** A finished tool call as a span result: its failure code, and the size of what it returned (never the data). */
export function toolSpanResult(out: { ok: boolean; code?: string; summary: string; data: Record<string, unknown> }): SpanResult {
  const resultBytes = Buffer.byteLength(JSON.stringify(out.data));
  return out.ok
    ? { status: "ok", metadata: { resultBytes } }
    : { status: "error", errorCategory: out.code ?? "TOOL_ERROR", errorMessage: out.summary, metadata: { resultBytes } };
}

/** Usage for a call that reported no tokens: every count unknown. */
export const emptyUsage = (patch: Partial<ModelCallTelemetry> = {}): ModelCallTelemetry => ({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  providerCost: null,
  attempts: null,
  providerRequestId: null,
  ...patch,
});

const OUTCOME_WORDS: Record<RunOutcome["status"], string> = {
  success: "succeeded",
  failure: "failed",
  cancelled: "cancelled",
  timeout: "timed out",
  interrupted: "interrupted",
};

const round = (ms: number) => Math.round(ms * 10) / 10;
