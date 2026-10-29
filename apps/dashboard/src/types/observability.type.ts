// Mirrors the server's /observability responses. Fields that can be unknown are
// null, never 0: render them as "Not reported" / "Unavailable".

export type ObservabilityRange = "1h" | "24h" | "7d" | "30d";
export type RunKind = "agent" | "investigation";
export type RunStatus = "running" | "success" | "failure" | "cancelled" | "timeout" | "interrupted";
export type RunStatusFilter = "success" | "failed" | "failure" | "timeout" | "cancelled" | "interrupted" | "running";
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type CostSource = "provider" | "estimate" | "mixed";

export type ObservabilityWindow = { key: ObservabilityRange; from: string; to: string; bucketMs: number };

export type PeriodStats = {
  runs: Record<RunStatus, number> & { total: number };
  successRate: number | null;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  avgModelDurationMs: number | null;
  tokens: { input: number | null; output: number | null; total: number | null; runsWithUsage: number; runsWithoutUsage: number };
  cost: { total: number | null; currency: "USD"; pricedRuns: number; unpricedRuns: number; sources: Record<CostSource, number> };
};

export type CallStat = { calls: number; errors: number; errorRate: number; avgMs: number; p95Ms: number | null; maxMs: number };

export type ObservabilitySummary = {
  window: ObservabilityWindow;
  kind: RunKind | null;
  current: PeriodStats;
  previous: PeriodStats | null;
  tools: (CallStat & { tool: string })[];
  models: (CallStat & { model: string })[];
  truncated: boolean;
  p95MinRuns: number;
};

export type TimeBucket = {
  start: string;
  runs: number;
  success: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  avgModelDurationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  unpricedRuns: number;
};

export type ObservabilityTimeseries = { window: ObservabilityWindow; kind: RunKind | null; buckets: TimeBucket[]; truncated: boolean };

export type AgentRun = {
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
  requestId: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  modelCallCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  retryCount: number | null;
  usageReportedCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  costCurrency: "USD" | null;
  costSource: CostSource | null;
  modelDurationMs: number | null;
  toolDurationMs: number | null;
};

export type AgentSpan = {
  spanId: string;
  runId: string;
  traceId: string;
  parentSpanId: string;
  seq: number;
  kind: "run" | "model" | "tool" | "stage";
  name: string;
  status: "ok" | "error" | "cancelled";
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
  context: Record<string, unknown>;
};

export type RunList = { runs: AgentRun[]; total: number; limit: number; offset: number; options: { models: string[]; tools: string[] } };
export type RunDetail = { run: AgentRun; spans: AgentSpan[]; logs: LogEntry[]; partial: string[] };
export type LogPage = { entries: LogEntry[]; nextBefore: number | null; limit: number; components: string[] };

export type RunQuery = {
  range: ObservabilityRange;
  kind?: RunKind;
  status?: RunStatusFilter;
  model?: string;
  tool?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  q?: string;
  sort?: "startedAt" | "durationMs" | "status";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type LogQuery = {
  range: ObservabilityRange;
  level?: LogLevel;
  errorsOnly?: boolean;
  component?: string;
  correlationId?: string;
  before?: number;
  limit?: number;
};

export type HealthCheck = {
  name: string;
  status: "ok" | "failing" | "unknown";
  checkedAt: string | null;
  lastOkAt: string | null;
  latencyMs: number | null;
  error: string | null;
};

export type RuntimeSample = {
  at: string;
  intervalMs: number;
  cpuPercent: number | null;
  eventLoopDelayP50Ms: number | null;
  eventLoopDelayP99Ms: number | null;
  eventLoopDelayMaxMs: number | null;
  heapUsedBytes: number;
  rssBytes: number;
};

export type RuntimeSnapshot = {
  measuredAt: string;
  scope: "process";
  status: "ok" | "degraded";
  process: { pid: number; startedAt: string; uptimeSeconds: number; nodeVersion: string; appVersion: string; platform: string };
  memory: {
    heapUsedBytes: number;
    heapTotalBytes: number;
    rssBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    constrainedMemoryBytes: number | null;
  };
  cpu: { percentOfOneCore: number | null; intervalMs: number; measuredAt: string } | null;
  eventLoop: { p50Ms: number | null; p99Ms: number | null; maxMs: number | null; intervalMs: number; measuredAt: string } | null;
  sampleIntervalMs: number;
  samples: RuntimeSample[];
  checks: HealthCheck[];
  telemetry: { runWriteFailures: number; logWriteFailures: number; logsDroppedOverBudget: number };
};
