import {
  AGGREGATE_MAX_ROWS,
  COMPARISON_MIN_RUNS,
  LOGS_PAGE,
  OBSERVABILITY_RANGES,
  P95_MIN_RUNS,
  RUN_DETAIL_MAX_LOGS,
  RUN_STATUSES,
  RUNS_PAGE,
} from "../constants/telemetry.constant.js";
import type { LogRow, RunRow, RunSort, SpanRow, TelemetryRepository } from "../database/repositories/telemetry.repository.js";
import { AppError } from "../lib/response.js";
import { bucketOf, bucketStarts, mean, percentile } from "../lib/telemetry-math.js";
import type {
  LogPage,
  LogQuery,
  ModelStat,
  PeriodStats,
  RunDetail,
  RunList,
  Summary,
  TimeBucket,
  Timeseries,
  ToolStat,
  Window,
} from "../types/observability.type.js";
import type { CostSource, LogEntry, LogLevel, ObservabilityRange, Run, RunKind, RunStatus, Span } from "../types/telemetry.type.js";

const LEVEL_NUM: Record<LogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
/** Statuses that count against the success rate. Cancelled (the user left) and running don't. */
const FAILED: RunStatus[] = ["failure", "timeout", "interrupted"];

export type RunListQuery = {
  range: ObservabilityRange;
  kind?: RunKind;
  status?: "success" | "failed" | "cancelled" | "running" | RunStatus;
  model?: string;
  tool?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  q?: string;
  sort?: RunSort;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

/**
 * Read side of the telemetry: KPIs, chart buckets, the run list, one run's
 * trace and the log search. All windows are real wall-clock time (telemetry
 * isn't case data, so the case's "today" doesn't apply), and every query is
 * bounded by a window and a row limit.
 */
export class ObservabilityService {
  constructor(
    private readonly repo: TelemetryRepository,
    private readonly now: () => number = Date.now,
  ) {}

  window(range: ObservabilityRange, offsetWindows = 0): Window {
    const { ms, bucketMs } = OBSERVABILITY_RANGES[range];
    // The end is exclusive, so it sits 1 ms past now: a run that started this millisecond is in the window.
    const to = this.now() + 1 - offsetWindows * ms;
    return { key: range, from: new Date(to - ms).toISOString(), to: new Date(to).toISOString(), bucketMs };
  }

  summary(range: ObservabilityRange, kind?: RunKind): Summary {
    const w = this.window(range);
    const prevW = this.window(range, 1);
    const [fromMs, toMs] = msOf(w);
    const rows = this.repo.runsInWindow(fromMs, toMs, kind, AGGREGATE_MAX_ROWS + 1);
    const truncated = rows.length > AGGREGATE_MAX_ROWS;
    const current = periodStats(rows.slice(0, AGGREGATE_MAX_ROWS));

    const prevRows = this.repo.runsInWindow(...msOf(prevW), kind, AGGREGATE_MAX_ROWS);
    const previous = periodStats(prevRows);
    const prevFinished = previous.runs.total - previous.runs.running;

    const spans = this.repo.spansInWindow(fromMs, toMs, kind, AGGREGATE_MAX_ROWS);
    return {
      window: w,
      kind: kind ?? null,
      current,
      previous: prevFinished >= COMPARISON_MIN_RUNS ? previous : null,
      tools: spanStats(spans.filter((s) => s.kind === "tool"), (s) => s.tool ?? "unknown").map(({ key, ...s }) => ({ tool: key, ...s })) as ToolStat[],
      models: spanStats(spans.filter((s) => s.kind === "model"), (s) => s.model ?? "unknown").map(({ key, ...s }) => ({ model: key, ...s })) as ModelStat[],
      truncated,
      p95MinRuns: P95_MIN_RUNS,
    };
  }

  timeseries(range: ObservabilityRange, kind?: RunKind): Timeseries {
    const w = this.window(range);
    const [fromMs, toMs] = msOf(w);
    const rows = this.repo.runsInWindow(fromMs, toMs, kind, AGGREGATE_MAX_ROWS + 1);
    return { window: w, kind: kind ?? null, buckets: buckets(rows.slice(0, AGGREGATE_MAX_ROWS), fromMs, toMs, w.bucketMs), truncated: rows.length > AGGREGATE_MAX_ROWS };
  }

  listRuns(q: RunListQuery): RunList {
    const [fromMs, toMs] = msOf(this.window(q.range));
    const limit = Math.min(q.limit ?? RUNS_PAGE.default, RUNS_PAGE.max);
    const offset = q.offset ?? 0;
    const statuses =
      q.status === "failed" ? FAILED : q.status === undefined ? undefined : RUN_STATUSES.includes(q.status as RunStatus) ? [q.status] : undefined;
    const { rows, total } = this.repo.listRuns(
      {
        fromMs,
        toMs,
        kind: q.kind,
        statuses,
        model: q.model,
        tool: q.tool,
        minDurationMs: q.minDurationMs,
        maxDurationMs: q.maxDurationMs,
        idPrefix: q.q,
      },
      q.sort ?? "startedAt",
      q.order ?? "desc",
      limit,
      offset,
    );
    const { models, tools } = this.repo.options();
    return { runs: rows.map(toRun), total, limit, offset, options: { models, tools } };
  }

  /** A run by run id or trace id, with its spans in order and the log lines that name it. */
  run(id: string): RunDetail {
    const row = this.repo.getRun(id) ?? this.repo.getRunByTrace(id);
    if (!row) throw new AppError(404, "RUN_NOT_FOUND", `No run with id ${id}`);
    const spans = this.repo.spans(row.run_id).map(toSpan);
    const logs = this.repo.runLogs(row.run_id, row.trace_id, RUN_DETAIL_MAX_LOGS).map(toLog);
    return { run: toRun(row), spans, logs, partial: partialReasons(row, spans) };
  }

  logs(q: LogQuery): LogPage {
    const [fromMs, toMs] = msOf(this.window(q.range));
    const limit = Math.min(q.limit ?? LOGS_PAGE.default, LOGS_PAGE.max);
    const minLevel = q.errorsOnly ? LEVEL_NUM.error : q.level ? LEVEL_NUM[q.level] : undefined;
    // One extra row tells whether there is an older page.
    const rows = this.repo.listLogs(
      { fromMs, toMs, minLevel, component: q.component, correlationId: q.correlationId, beforeId: q.before },
      limit + 1,
    );
    const page = rows.slice(0, limit);
    return {
      entries: page.map(toLog),
      nextBefore: rows.length > limit ? page.at(-1)!.id : null,
      limit,
      components: this.repo.options().components,
    };
  }
}

const msOf = (w: Window): [number, number] => [Date.parse(w.from), Date.parse(w.to)];

export function periodStats(rows: RunRow[]): PeriodStats {
  const runs = Object.fromEntries(RUN_STATUSES.map((s) => [s, 0])) as PeriodStats["runs"];
  runs.total = rows.length;
  for (const r of rows) runs[r.status as RunStatus] = (runs[r.status as RunStatus] ?? 0) + 1;
  const judged = runs.success + FAILED.reduce((n, s) => n + runs[s], 0);

  const ok = rows.filter((r) => r.status === "success" && r.duration_ms !== null);
  const durations = ok.map((r) => r.duration_ms!);
  const modelDurations = ok.map((r) => r.model_duration_ms).filter((d): d is number => d !== null);

  const finished = rows.filter((r) => r.status !== "running");
  const withUsage = finished.filter((r) => r.usage_reported_calls > 0);
  const sumOf = (pick: (r: RunRow) => number | null) => {
    const values = withUsage.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
  };
  // Runs that made no model call (e.g. an investigation with too little data) have no cost to know.
  const costed = finished.filter((r) => r.model_call_count > 0);
  const priced = costed.filter((r) => r.cost_usd !== null);
  const sources: Record<CostSource, number> = { provider: 0, estimate: 0, mixed: 0 };
  for (const r of priced) if (r.cost_source) sources[r.cost_source as CostSource]++;

  return {
    runs,
    successRate: judged === 0 ? null : runs.success / judged,
    avgDurationMs: round(mean(durations)),
    p50DurationMs: round(percentile(durations, 50)),
    p95DurationMs: durations.length >= P95_MIN_RUNS ? round(percentile(durations, 95)) : null,
    avgModelDurationMs: round(mean(modelDurations)),
    tokens: {
      input: sumOf((r) => r.input_tokens),
      output: sumOf((r) => r.output_tokens),
      total: sumOf((r) => r.total_tokens),
      runsWithUsage: withUsage.length,
      runsWithoutUsage: finished.filter((r) => r.model_call_count > 0).length - withUsage.length,
    },
    cost: {
      total: priced.length === 0 ? null : priced.reduce((s, r) => s + r.cost_usd!, 0),
      currency: "USD",
      pricedRuns: priced.length,
      unpricedRuns: costed.length - priced.length,
      sources,
    },
  };
}

export function buckets(rows: RunRow[], fromMs: number, toMs: number, bucketMs: number): TimeBucket[] {
  const byStart = new Map<number, RunRow[]>(bucketStarts(fromMs, toMs, bucketMs).map((t) => [t, []]));
  for (const r of rows) if (r.started_at >= fromMs && r.started_at < toMs) byStart.get(bucketOf(r.started_at, bucketMs))?.push(r);
  return [...byStart].map(([start, rs]) => {
    const ok = rs.filter((r) => r.status === "success" && r.duration_ms !== null);
    const durations = ok.map((r) => r.duration_ms!);
    const model = ok.map((r) => r.model_duration_ms).filter((d): d is number => d !== null);
    const used = rs.filter((r) => r.usage_reported_calls > 0);
    const costed = rs.filter((r) => r.status !== "running" && r.model_call_count > 0);
    const priced = costed.filter((r) => r.cost_usd !== null);
    const sum = (values: (number | null)[]) => {
      const known = values.filter((v): v is number => v !== null);
      return known.length === 0 ? null : known.reduce((s, v) => s + v, 0);
    };
    return {
      start: new Date(start).toISOString(),
      runs: rs.length,
      success: rs.filter((r) => r.status === "success").length,
      failed: rs.filter((r) => FAILED.includes(r.status as RunStatus)).length,
      cancelled: rs.filter((r) => r.status === "cancelled").length,
      avgDurationMs: round(mean(durations)),
      maxDurationMs: durations.length ? Math.max(...durations) : null,
      avgModelDurationMs: round(mean(model)),
      inputTokens: sum(used.map((r) => r.input_tokens)),
      outputTokens: sum(used.map((r) => r.output_tokens)),
      cost: sum(priced.map((r) => r.cost_usd)),
      unpricedRuns: costed.length - priced.length,
    };
  });
}

type SpanStatRow = Pick<SpanRow, "status" | "duration_ms">;

function spanStats<T extends SpanStatRow>(spans: T[], keyOf: (s: T) => string) {
  const groups = new Map<string, T[]>();
  for (const s of spans) groups.set(keyOf(s), [...(groups.get(keyOf(s)) ?? []), s]);
  return [...groups]
    .map(([key, ss]) => {
      const durations = ss.map((s) => s.duration_ms);
      const errors = ss.filter((s) => s.status === "error").length;
      return {
        key,
        calls: ss.length,
        errors,
        errorRate: errors / ss.length,
        avgMs: round(mean(durations))!,
        p95Ms: ss.length >= P95_MIN_RUNS ? round(percentile(durations, 95)) : null,
        maxMs: Math.max(...durations),
      };
    })
    .sort((a, b) => b.avgMs - a.avgMs);
}

function partialReasons(row: RunRow, spans: Span[]): string[] {
  const reasons: string[] = [];
  if (row.status === "running") reasons.push("The run is still in progress; spans appear as each step finishes.");
  if (row.status === "interrupted") reasons.push("The server stopped during this run; steps after the last recorded span are missing.");
  const models = spans.filter((s) => s.kind === "model").length;
  const tools = spans.filter((s) => s.kind === "tool").length;
  if (row.status !== "running" && (models < row.model_call_count || tools < row.tool_call_count)) {
    reasons.push(
      `Some spans weren't recorded (${models} of ${row.model_call_count} model calls, ${tools} of ${row.tool_call_count} tool calls), most likely a failed telemetry write.`,
    );
  }
  return reasons;
}

export function toRun(r: RunRow): Run {
  return {
    runId: r.run_id,
    traceId: r.trace_id,
    rootSpanId: r.root_span_id,
    kind: r.kind as RunKind,
    status: r.status as RunStatus,
    startedAt: new Date(r.started_at).toISOString(),
    completedAt: r.completed_at === null ? null : new Date(r.completed_at).toISOString(),
    durationMs: r.duration_ms,
    provider: r.provider,
    model: r.model,
    requestId: r.request_id,
    errorCategory: r.error_category,
    errorMessage: r.error_message,
    modelCallCount: r.model_call_count,
    toolCallCount: r.tool_call_count,
    toolErrorCount: r.tool_error_count,
    retryCount: r.retry_count,
    usageReportedCalls: r.usage_reported_calls,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    totalTokens: r.total_tokens,
    estimatedCost: r.cost_usd,
    costCurrency: r.cost_usd === null ? null : "USD",
    costSource: r.cost_source as CostSource | null,
    modelDurationMs: r.model_duration_ms,
    toolDurationMs: r.tool_duration_ms,
  };
}

function toSpan(s: SpanRow): Span {
  return {
    spanId: s.span_id,
    runId: s.run_id,
    traceId: s.trace_id,
    parentSpanId: s.parent_span_id,
    seq: s.seq,
    kind: s.kind as Span["kind"],
    name: s.name,
    status: s.status as Span["status"],
    startedAt: new Date(s.started_at).toISOString(),
    durationMs: s.duration_ms,
    model: s.model,
    tool: s.tool,
    inputTokens: s.input_tokens,
    outputTokens: s.output_tokens,
    totalTokens: s.total_tokens,
    cachedInputTokens: s.cached_input_tokens,
    reasoningTokens: s.reasoning_tokens,
    cost: s.cost_usd,
    costSource: s.cost_source as Span["costSource"],
    attempts: s.attempts,
    providerRequestId: s.provider_request_id,
    errorCategory: s.error_category,
    errorMessage: s.error_message,
    metadata: parseJson(s.metadata),
  };
}

function toLog(l: LogRow): LogEntry {
  return {
    id: l.id,
    timestamp: new Date(l.ts).toISOString(),
    level: l.level as LogLevel,
    component: l.component,
    message: l.message,
    runId: l.run_id,
    traceId: l.trace_id,
    requestId: l.request_id,
    errorCategory: l.error_category,
    durationMs: l.duration_ms,
    context: parseJson(l.context),
  };
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
