/** Time windows the observability API accepts, and the chart bucket for each. */
export const OBSERVABILITY_RANGES = {
  "1h": { ms: 3_600_000, bucketMs: 5 * 60_000 },
  "24h": { ms: 86_400_000, bucketMs: 3_600_000 },
  "7d": { ms: 7 * 86_400_000, bucketMs: 6 * 3_600_000 },
  "30d": { ms: 30 * 86_400_000, bucketMs: 86_400_000 },
} as const;
export const OBSERVABILITY_RANGE_KEYS = Object.keys(OBSERVABILITY_RANGES) as (keyof typeof OBSERVABILITY_RANGES)[];
export const OBSERVABILITY_DEFAULT_RANGE = "24h";

export const RUN_KINDS = ["agent", "investigation", "creative_concepts", "creative_brief", "creative_image"] as const;
export const RUN_STATUSES = ["running", "success", "failure", "cancelled", "timeout", "interrupted"] as const;
export const SPAN_KINDS = ["run", "model", "tool", "stage"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

/** Pino's numeric levels. */
export const PINO_LEVELS: Record<number, (typeof LOG_LEVELS)[number]> = { 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };

/** Page sizes: default and hard maximum, enforced by the route schemas. */
export const RUNS_PAGE = { default: 25, max: 100 };
export const LOGS_PAGE = { default: 50, max: 200 };
/** Logs shown with a run in its inspector. */
export const RUN_DETAIL_MAX_LOGS = 100;
/** Rows a summary or chart reads at most; a busier window is reported as truncated. */
export const AGGREGATE_MAX_ROWS = 20_000;

/** P95 needs this many runs to be worth showing; fewer and it is just the slowest run. */
export const P95_MIN_RUNS = 20;
/** The previous period is compared only when it has at least this many runs. */
export const COMPARISON_MIN_RUNS = 5;

/**
 * Logs persisted per minute at most. A burst beyond that (a crash loop, a flood
 * of warnings) is counted and reported once, so telemetry can't fill the disk.
 */
export const LOG_WRITE_BUDGET_PER_MINUTE = 600;
/** Hard cap on stored log rows; the oldest go first. */
export const LOG_MAX_ROWS = 50_000;
/** How often old telemetry is deleted (also once at boot). */
export const RETENTION_SWEEP_MS = 3_600_000;

/** Size limits for anything stored from a log call or an error. */
export const MAX_MESSAGE_CHARS = 500;
export const MAX_CONTEXT_BYTES = 4_096;
export const MAX_STACK_LINES = 8;

/** Runtime sampler: one cheap sample every interval, the last `RUNTIME_SAMPLES` kept in memory (~10 min). */
export const RUNTIME_SAMPLE_MS = 10_000;
export const RUNTIME_SAMPLES = 60;

/** Marks the recorder's own warnings so the log sink never tries to store them in the store that just failed. */
export const TELEMETRY_INTERNAL = "telemetry-internal";
