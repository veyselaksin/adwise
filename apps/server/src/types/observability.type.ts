import type { CostSource, LogEntry, LogLevel, ObservabilityRange, Run, RunKind, RunStatus, Span } from "./telemetry.type.js";

export type Window = { key: ObservabilityRange; from: string; to: string; bucketMs: number };

export type RunCounts = Record<RunStatus, number> & { total: number };

/** KPIs for one window. Every figure that can be unknown is null, never 0. */
export type PeriodStats = {
  runs: RunCounts;
  /** success ÷ (success + failure + timeout + interrupted); cancelled runs are left out. Null with none of those. */
  successRate: number | null;
  /** Over successful runs. */
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  /** Null under P95_MIN_RUNS successful runs. */
  p95DurationMs: number | null;
  /** Mean of the model calls' summed time per successful run. */
  avgModelDurationMs: number | null;
  tokens: { input: number | null; output: number | null; total: number | null; runsWithUsage: number; runsWithoutUsage: number };
  cost: { total: number | null; currency: "USD"; pricedRuns: number; unpricedRuns: number; sources: Record<CostSource, number> };
};

export type ToolStat = { tool: string; calls: number; errors: number; errorRate: number; avgMs: number; p95Ms: number | null; maxMs: number };
export type ModelStat = { model: string; calls: number; errors: number; errorRate: number; avgMs: number; p95Ms: number | null; maxMs: number };

export type Summary = {
  window: Window;
  kind: RunKind | null;
  current: PeriodStats;
  /** The window just before, only with COMPARISON_MIN_RUNS+ finished runs in it. */
  previous: PeriodStats | null;
  tools: ToolStat[];
  models: ModelStat[];
  /** More runs than AGGREGATE_MAX_ROWS in the window: figures cover the oldest ones only. */
  truncated: boolean;
  p95MinRuns: number;
};

export type TimeBucket = {
  start: string;
  runs: number;
  success: number;
  /** failure + timeout + interrupted */
  failed: number;
  cancelled: number;
  /** Over successful runs in the bucket; null with none. */
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  avgModelDurationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  /** Runs whose cost is unknown; `cost` leaves them out. */
  unpricedRuns: number;
};

export type Timeseries = { window: Window; kind: RunKind | null; buckets: TimeBucket[]; truncated: boolean };

export type RunList = {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
  /** Values seen in the store, for the filter menus. */
  options: { models: string[]; tools: string[] };
};

export type RunDetail = {
  run: Run;
  spans: Span[];
  logs: LogEntry[];
  /** Why the trace may be incomplete; empty when every span was recorded. */
  partial: string[];
};

export type LogPage = {
  entries: LogEntry[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextBefore: number | null;
  limit: number;
  components: string[];
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
  /** Always this one process: not the host, the container or other instances. */
  scope: "process";
  status: "ok" | "degraded";
  process: { pid: number; startedAt: string; uptimeSeconds: number; nodeVersion: string; appVersion: string; platform: string };
  memory: {
    heapUsedBytes: number;
    heapTotalBytes: number;
    rssBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    /** A memory limit applied to the process (e.g. a cgroup), when there is one. */
    constrainedMemoryBytes: number | null;
  };
  /** Null until the first sample, RUNTIME_SAMPLE_MS after boot. */
  cpu: { percentOfOneCore: number | null; intervalMs: number; measuredAt: string } | null;
  eventLoop: { p50Ms: number | null; p99Ms: number | null; maxMs: number | null; intervalMs: number; measuredAt: string } | null;
  sampleIntervalMs: number;
  samples: RuntimeSample[];
  checks: HealthCheck[];
  telemetry: { runWriteFailures: number; logWriteFailures: number; logsDroppedOverBudget: number };
};
