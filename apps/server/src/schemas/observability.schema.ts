import Type, { type TSchema } from "typebox";
import {
  LOG_LEVELS,
  LOGS_PAGE,
  OBSERVABILITY_DEFAULT_RANGE,
  OBSERVABILITY_RANGE_KEYS,
  RUN_KINDS,
  RUN_STATUSES,
  RUNS_PAGE,
  SPAN_KINDS,
} from "../constants/telemetry.constant.js";
import { literals } from "./common.schema.js";

/** A value that is null when it wasn't reported or can't be computed, never 0 by default. */
const nullable = <T extends TSchema>(schema: T, description: string, example: unknown = null) =>
  Type.Union([schema, Type.Null()], { description, examples: [example] });
const nNum = (description: string, example: number | null = null) => nullable(Type.Number(), description, example);
const nInt = (description: string, example: number | null = null) => nullable(Type.Integer(), description, example);
const nStr = (description: string, example: string | null = null) => nullable(Type.String(), description, example);
const Timestamp = (description: string) => Type.String({ format: "date-time", description, examples: ["2026-10-29T11:27:04.512Z"] });
const AnyObject = (description: string) => Type.Object({}, { additionalProperties: true, description });

const Range = literals(OBSERVABILITY_RANGE_KEYS, {
  default: OBSERVABILITY_DEFAULT_RANGE,
  description: "Time window ending now (wall-clock time, not the case's calendar)",
});
const Kind = literals([...RUN_KINDS], { description: "agent (chat questions), investigation (campaign investigations), creative_concepts (Creative Studio concepts), creative_brief (Creative Studio brief suggestions) or creative_image (Creative Studio images)" });
/** Ids are UUIDs or hex; nothing else can reach the store's LIKE. */
const Id = (description: string, minLength = 1) => Type.String({ minLength, maxLength: 64, pattern: "^[A-Za-z0-9-]+$", description });

export const RangeQuery = Type.Object({ range: Range, kind: Type.Optional(Kind) });

const Window = Type.Object(
  {
    key: Range,
    from: Timestamp("Window start, inclusive"),
    to: Timestamp("Window end, exclusive (when the request was served)"),
    bucketMs: Type.Integer({ description: "Chart bucket size for this window, in ms", examples: [3_600_000] }),
  },
  { title: "ObservabilityWindow" },
);

const RunCounts = Type.Object(
  {
    total: Type.Integer({ examples: [42] }),
    ...Object.fromEntries(RUN_STATUSES.map((s) => [s, Type.Integer({ examples: [s === "success" ? 38 : 1] })])),
  },
  { title: "RunCounts" },
);

const PeriodStats = Type.Object(
  {
    runs: RunCounts,
    successRate: nNum("success ÷ (success + failure + timeout + interrupted); cancelled and running runs are left out. Null when none of those ended.", 0.95),
    avgDurationMs: nNum("Mean end-to-end duration of successful runs, ms", 18342.5),
    p50DurationMs: nNum("Median duration of successful runs, ms", 16120),
    p95DurationMs: nNum("95th percentile (nearest rank) of successful runs, ms; null under p95MinRuns runs", null),
    avgModelDurationMs: nNum("Mean time spent in model calls per successful run, ms", 15210.3),
    tokens: Type.Object({
      input: nInt("Provider-reported prompt tokens, summed over runs that reported usage", 182_340),
      output: nInt("Provider-reported completion tokens (reasoning included)", 9_120),
      total: nInt("Provider-reported total tokens", 191_460),
      runsWithUsage: Type.Integer({ examples: [40] }),
      runsWithoutUsage: Type.Integer({ description: "Finished runs with model calls but no reported usage", examples: [2] }),
    }),
    cost: Type.Object({
      total: nNum("USD over runs whose cost is known; null when none is", 0.0412),
      currency: Type.Literal("USD"),
      pricedRuns: Type.Integer({ examples: [40] }),
      unpricedRuns: Type.Integer({ description: "Runs with model calls whose cost is unknown; left out of total", examples: [2] }),
      sources: Type.Object({ provider: Type.Integer(), estimate: Type.Integer(), mixed: Type.Integer() }, { description: "Priced runs by where their cost came from" }),
    }),
  },
  { title: "PeriodStats" },
);

const CallStat = (key: "tool" | "model", example: string) =>
  Type.Object({
    [key]: Type.String({ examples: [example] }),
    calls: Type.Integer({ examples: [120] }),
    errors: Type.Integer({ examples: [3] }),
    errorRate: Type.Number({ examples: [0.025] }),
    avgMs: Type.Number({ examples: [42.1] }),
    p95Ms: nNum("Null under p95MinRuns calls", 88),
    maxMs: Type.Number({ examples: [140.2] }),
  });

export const Summary = Type.Object(
  {
    window: Window,
    kind: Type.Union([Kind, Type.Null()]),
    current: PeriodStats,
    previous: Type.Union([PeriodStats, Type.Null()], { description: "The window just before, when it has enough finished runs to compare" }),
    tools: Type.Array(CallStat("tool", "query_metrics"), { description: "Tool calls in the window, slowest on average first" }),
    models: Type.Array(CallStat("model", "deepseek/deepseek-v4.1-flash"), { description: "Model calls in the window, slowest on average first" }),
    truncated: Type.Boolean({ description: "The window had more runs than the aggregate limit; figures cover the oldest ones" }),
    p95MinRuns: Type.Integer({ examples: [20] }),
  },
  { title: "ObservabilitySummary" },
);

const TimeBucket = Type.Object({
  start: Timestamp("Bucket start (UTC)"),
  runs: Type.Integer(),
  success: Type.Integer(),
  failed: Type.Integer({ description: "failure + timeout + interrupted" }),
  cancelled: Type.Integer(),
  avgDurationMs: nNum("Successful runs only; null when there were none"),
  maxDurationMs: nNum("Successful runs only"),
  avgModelDurationMs: nNum("Model time per successful run"),
  inputTokens: nInt("Reported prompt tokens; null when no run in the bucket reported usage"),
  outputTokens: nInt("Reported completion tokens"),
  cost: nNum("USD over priced runs; null when none"),
  unpricedRuns: Type.Integer(),
});

export const Timeseries = Type.Object(
  { window: Window, kind: Type.Union([Kind, Type.Null()]), buckets: Type.Array(TimeBucket), truncated: Type.Boolean() },
  { title: "ObservabilityTimeseries" },
);

const RunStatus = literals([...RUN_STATUSES]);

export const Run = Type.Object(
  {
    runId: Type.String({ format: "uuid", examples: ["4f7c0a52-2b8e-4a8e-9a1c-0d5b4e3f2a10"] }),
    traceId: Type.String({ examples: ["7d2c0c1f9b3e4a51a8a3f0e6d4c2b1a0"] }),
    rootSpanId: Type.String({ examples: ["a1b2c3d4e5f60718"] }),
    kind: Kind,
    status: RunStatus,
    startedAt: Timestamp("When the run started"),
    completedAt: nullable(Type.String({ format: "date-time" }), "Null while running or when interrupted"),
    durationMs: nNum("End-to-end, from request to the last event; monotonic clock", 18342.5),
    provider: Type.String({ examples: ["zenmux"] }),
    model: Type.String({ examples: ["deepseek/deepseek-v4.1-flash"] }),
    requestId: nStr("The HTTP request that started it", "req-1a"),
    errorCategory: nStr("Stable code, e.g. RATE_LIMITED, MODEL_TIMEOUT, INTERNAL_ERROR", null),
    errorMessage: nStr("Redacted, at most 500 characters", null),
    modelCallCount: Type.Integer({ examples: [2] }),
    toolCallCount: Type.Integer({ examples: [1] }),
    toolErrorCount: Type.Integer({ examples: [0] }),
    retryCount: nInt("Extra attempts to open model streams (429/5xx); null when not reported", 0),
    usageReportedCalls: Type.Integer({ description: "Model calls that reported token usage", examples: [2] }),
    inputTokens: nInt("Provider-reported, summed over the run's calls", 9_120),
    outputTokens: nInt("Provider-reported", 412),
    totalTokens: nInt("Provider-reported", 9_532),
    estimatedCost: nNum("USD; null unless every model call has a cost (reported by the provider or estimated from configured prices)", 0.0016),
    costCurrency: Type.Union([Type.Literal("USD"), Type.Null()]),
    costSource: Type.Union([literals(["provider", "estimate", "mixed"]), Type.Null()]),
    modelDurationMs: nNum("Sum of the model calls' durations", 15210.3),
    toolDurationMs: nNum("Sum of the tool calls' durations (they can run in parallel)", 38.2),
  },
  { title: "AgentRun" },
);

const Span = Type.Object(
  {
    spanId: Type.String({ examples: ["c0ffee0123456789"] }),
    runId: Type.String(),
    traceId: Type.String(),
    parentSpanId: Type.String({ description: "The run's root span" }),
    seq: Type.Integer({ description: "Order in which spans started", examples: [1] }),
    kind: literals([...SPAN_KINDS]),
    name: Type.String({ examples: ["Model call 1"] }),
    status: literals(["ok", "error", "cancelled"]),
    startedAt: Timestamp("Span start"),
    durationMs: Type.Number({ examples: [8120.4] }),
    model: nStr("Model spans"),
    tool: nStr("Tool spans"),
    inputTokens: nInt("Reported by the provider for this call"),
    outputTokens: nInt("Reported by the provider for this call"),
    totalTokens: nInt("Reported by the provider for this call"),
    cachedInputTokens: nInt("Prompt tokens served from the provider's cache"),
    reasoningTokens: nInt("Part of outputTokens"),
    cost: nNum("USD for this call"),
    costSource: Type.Union([literals(["provider", "estimate"]), Type.Null()]),
    attempts: nInt("Attempts to open the stream, retries included"),
    providerRequestId: nStr("ZenMux's request id, for support tickets"),
    errorCategory: nStr("Stable code"),
    errorMessage: nStr("Redacted"),
    metadata: AnyObject("Safe facts only: step, tool label, argument names, result size"),
  },
  { title: "AgentSpan" },
);

const LogEntry = Type.Object(
  {
    id: Type.Integer({ examples: [1042] }),
    timestamp: Timestamp("When it was logged"),
    level: literals([...LOG_LEVELS]),
    component: nStr("agent, agent-run, investigation, telemetry, http, server", "agent-run"),
    message: Type.String({ examples: ["Agent run succeeded"] }),
    runId: nStr("Correlates with /observability/runs/{id}"),
    traceId: nStr("Correlates with a run's trace"),
    requestId: nStr("Fastify request id"),
    errorCategory: nStr("Stable code when the line is about a failure"),
    durationMs: nNum("When the line reports a duration"),
    context: AnyObject("The log call's other fields, redacted and capped at 4 KB"),
  },
  { title: "LogEntry" },
);

export const RunList = Type.Object(
  {
    runs: Type.Array(Run),
    total: Type.Integer({ description: "Runs matching the filters", examples: [42] }),
    limit: Type.Integer({ examples: [RUNS_PAGE.default] }),
    offset: Type.Integer({ examples: [0] }),
    options: Type.Object({ models: Type.Array(Type.String()), tools: Type.Array(Type.String()) }, { description: "Values for the filter menus" }),
  },
  { title: "RunList" },
);

export const RunListQuery = Type.Object({
  range: Range,
  kind: Type.Optional(Kind),
  status: Type.Optional(literals(["success", "failed", "failure", "timeout", "cancelled", "interrupted", "running"], { description: "`failed` = failure + timeout + interrupted" })),
  model: Type.Optional(Type.String({ maxLength: 100, examples: ["deepseek/deepseek-v4.1-flash"] })),
  tool: Type.Optional(Type.String({ maxLength: 100, pattern: "^[a-z_]+$", examples: ["query_metrics"], description: "Runs that called this tool" })),
  minDurationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 3_600_000 })),
  maxDurationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 3_600_000 })),
  q: Type.Optional(Id("Start of a run id or trace id", 4)),
  sort: Type.Optional(literals(["startedAt", "durationMs", "status"], { default: "startedAt" })),
  order: Type.Optional(literals(["asc", "desc"], { default: "desc" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: RUNS_PAGE.max, default: RUNS_PAGE.default })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000, default: 0 })),
});

export const RunParams = Type.Object({ id: Id("A run id or trace id") });

export const RunDetail = Type.Object(
  {
    run: Run,
    spans: Type.Array(Span, { description: "In start order; each has the run's root span as parent" }),
    logs: Type.Array(LogEntry, { description: "Persisted log lines naming this run, newest first (at most 100)" }),
    partial: Type.Array(Type.String(), { description: "Why the trace may be incomplete; empty when it isn't" }),
  },
  { title: "RunDetail" },
);

export const LogQuery = Type.Object({
  range: Range,
  level: Type.Optional(literals([...LOG_LEVELS], { description: "Minimum level" })),
  errorsOnly: Type.Optional(Type.Boolean({ description: "error and fatal only (overrides level)" })),
  component: Type.Optional(Type.String({ maxLength: 50, pattern: "^[a-z-]+$", examples: ["agent"] })),
  correlationId: Type.Optional(Id("Exact run id, trace id or request id")),
  before: Type.Optional(Type.Integer({ minimum: 1, description: "`nextBefore` from the previous page" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LOGS_PAGE.max, default: LOGS_PAGE.default })),
});

export const LogPage = Type.Object(
  {
    entries: Type.Array(LogEntry),
    nextBefore: nInt("Pass as `before` for older entries; null on the last page"),
    limit: Type.Integer({ examples: [LOGS_PAGE.default] }),
    components: Type.Array(Type.String(), { description: "Components seen in the store" }),
  },
  { title: "LogPage" },
);

const HealthCheck = Type.Object({
  name: Type.String({ examples: ["Case database"] }),
  status: literals(["ok", "failing", "unknown"]),
  checkedAt: nullable(Type.String({ format: "date-time" }), "Last check (checks closer than 5 s reuse the result)"),
  lastOkAt: nullable(Type.String({ format: "date-time" }), "Last successful check"),
  latencyMs: nNum("How long the check took"),
  error: nStr("Redacted"),
});

const Sample = Type.Object({
  at: Timestamp("Sample time"),
  intervalMs: Type.Integer({ description: "Wall time the CPU and event-loop figures cover" }),
  cpuPercent: nNum("Process CPU time ÷ wall time × 100 over the interval; 100 = one core busy"),
  eventLoopDelayP50Ms: nNum("Median event-loop delay beyond the 20 ms sampling period, over the interval"),
  eventLoopDelayP99Ms: nNum("99th percentile event-loop delay"),
  eventLoopDelayMaxMs: nNum("Worst event-loop delay"),
  heapUsedBytes: Type.Integer(),
  rssBytes: Type.Integer(),
});

export const RuntimeSnapshot = Type.Object(
  {
    measuredAt: Timestamp("When memory was read"),
    scope: Type.Literal("process", { description: "This one server process: not the host, the container or other instances" }),
    status: literals(["ok", "degraded"], { description: "ok when every dependency check passed" }),
    process: Type.Object({
      pid: Type.Integer(),
      startedAt: Timestamp("Process start"),
      uptimeSeconds: Type.Integer(),
      nodeVersion: Type.String({ examples: ["v26.12.1"] }),
      appVersion: Type.String({ examples: ["v0.1.0"] }),
      platform: Type.String({ examples: ["linux/x64"] }),
    }),
    memory: Type.Object(
      {
        heapUsedBytes: Type.Integer({ description: "V8 heap in use (JS objects)" }),
        heapTotalBytes: Type.Integer({ description: "V8 heap reserved" }),
        rssBytes: Type.Integer({ description: "Resident set size: all memory the process holds in RAM" }),
        externalBytes: Type.Integer({ description: "C++ objects bound to JS (buffers, native modules)" }),
        arrayBuffersBytes: Type.Integer(),
        constrainedMemoryBytes: nInt("A memory limit applied to the process (cgroup), when there is one"),
      },
      { description: "process.memoryUsage(), in bytes" },
    ),
    cpu: Type.Union([
      Type.Object({ percentOfOneCore: nNum("Over the last sample interval"), intervalMs: Type.Integer(), measuredAt: Timestamp("Sample time") }),
      Type.Null(),
    ]),
    eventLoop: Type.Union([
      Type.Object({ p50Ms: nNum("Median delay beyond the 20 ms sampling period"), p99Ms: nNum("p99 delay"), maxMs: nNum("Max delay"), intervalMs: Type.Integer(), measuredAt: Timestamp("Sample time") }),
      Type.Null(),
    ]),
    sampleIntervalMs: Type.Integer({ examples: [10_000] }),
    samples: Type.Array(Sample, { description: "Recent samples kept in memory (about 10 minutes); empty after a restart" }),
    checks: Type.Array(HealthCheck),
    telemetry: Type.Object({
      runWriteFailures: Type.Integer({ description: "Run/span writes that failed since boot" }),
      logWriteFailures: Type.Integer(),
      logsDroppedOverBudget: Type.Integer({ description: "Log lines not stored because of the per-minute budget" }),
    }),
  },
  { title: "RuntimeSnapshot" },
);
