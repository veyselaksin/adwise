import type { LOG_LEVELS, OBSERVABILITY_RANGE_KEYS, RUN_KINDS, RUN_STATUSES, SPAN_KINDS } from "../constants/telemetry.constant.js";

export type RunKind = (typeof RUN_KINDS)[number];
/**
 * `success`: the run delivered its answer (agent) or interpretation (investigation).
 * `failure`: it ended with an error event. `cancelled`: the client went away.
 * `timeout`: the model didn't finish in MODEL_TIMEOUT_MS. `interrupted`: the
 * process stopped while it ran (found still `running` at the next boot).
 */
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SpanKind = (typeof SPAN_KINDS)[number];
export type SpanStatus = "ok" | "error" | "cancelled";
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ObservabilityRange = (typeof OBSERVABILITY_RANGE_KEYS)[number];

/** Where a cost figure came from. `mixed`: a run whose calls had both. */
export type CostSource = "provider" | "estimate" | "mixed";

/** One agent or investigation execution. Token and cost fields are null when not reported, never 0 by default. */
export type Run = {
  runId: string;
  traceId: string;
  rootSpanId: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  provider: string;
  model: string;
  /** The HTTP request that started the run (Fastify's request id). */
  requestId: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  modelCallCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  /** Extra attempts to open model streams (429/5xx retries); null when no call reported it. */
  retryCount: number | null;
  /** Model calls that reported token usage. Fewer than modelCallCount makes the token totals partial. */
  usageReportedCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** USD. Only set when every model call has a cost (reported or estimated). */
  estimatedCost: number | null;
  costCurrency: "USD" | null;
  costSource: CostSource | null;
  /** Sum of the model calls' durations; the rest of durationMs is tools, the server and streaming to the client. */
  modelDurationMs: number | null;
  toolDurationMs: number | null;
};

export type Span = {
  spanId: string;
  runId: string;
  traceId: string;
  parentSpanId: string;
  seq: number;
  kind: SpanKind;
  name: string;
  status: SpanStatus;
  startedAt: string;
  durationMs: number;
  model: string | null;
  tool: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  cost: number | null;
  costSource: "provider" | "estimate" | null;
  attempts: number | null;
  providerRequestId: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  /** Safe facts only: step number, tool label, argument names, result size. Never results or prompts. */
  metadata: Record<string, unknown>;
};

export type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  component: string | null;
  message: string;
  runId: string | null;
  traceId: string | null;
  requestId: string | null;
  errorCategory: string | null;
  durationMs: number | null;
  /** Redacted, size-capped fields of the log call. */
  context: Record<string, unknown>;
};

/** What a model span records about its call; the client fills it from the provider's response. */
export type ModelCallTelemetry = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  /** USD reported by the provider for this call. */
  providerCost: number | null;
  attempts: number | null;
  providerRequestId: string | null;
};
