import type { SQLInputValue, StatementSync } from "node:sqlite";
import type { TelemetryDatabase } from "../telemetry.connection.js";

/** Rows as stored: snake_case, epoch milliseconds, JSON as text. */
export type RunRow = {
  run_id: string;
  trace_id: string;
  root_span_id: string;
  kind: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  provider: string;
  model: string;
  request_id: string | null;
  error_category: string | null;
  error_message: string | null;
  model_call_count: number;
  tool_call_count: number;
  tool_error_count: number;
  retry_count: number | null;
  usage_reported_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  cost_source: string | null;
  model_duration_ms: number | null;
  tool_duration_ms: number | null;
};

export type SpanRow = {
  span_id: string;
  run_id: string;
  trace_id: string;
  parent_span_id: string;
  seq: number;
  kind: string;
  name: string;
  status: string;
  started_at: number;
  duration_ms: number;
  model: string | null;
  tool: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  cost_source: string | null;
  attempts: number | null;
  provider_request_id: string | null;
  error_category: string | null;
  error_message: string | null;
  metadata: string;
};

export type LogRow = {
  id: number;
  ts: number;
  level: string;
  level_num: number;
  component: string | null;
  message: string;
  run_id: string | null;
  trace_id: string | null;
  request_id: string | null;
  error_category: string | null;
  duration_ms: number | null;
  context: string;
};

export type NewRun = Pick<RunRow, "run_id" | "trace_id" | "root_span_id" | "kind" | "started_at" | "provider" | "model" | "request_id">;
export type RunCompletion = Omit<RunRow, keyof NewRun>;
export type NewLog = Omit<LogRow, "id">;

export type RunFilter = {
  fromMs: number;
  toMs: number;
  kind?: string;
  statuses?: string[];
  model?: string;
  tool?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  /** Prefix of a run id or trace id. The route only lets [A-Za-z0-9-] through, so it can't carry LIKE wildcards. */
  idPrefix?: string;
};

export type LogFilter = {
  fromMs: number;
  toMs: number;
  minLevel?: number;
  component?: string;
  /** Exact run id or trace id. */
  correlationId?: string;
  beforeId?: number;
};

/** Sortable columns, by API name. Only these fixed fragments ever reach ORDER BY. */
const RUN_SORT = { startedAt: "started_at", durationMs: "duration_ms", status: "status" } as const;
export type RunSort = keyof typeof RUN_SORT;

/**
 * SQL over the telemetry file. Every value goes in as a bound parameter;
 * the only SQL built from input is a choice between fixed fragments.
 */
export class TelemetryRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(private readonly db: TelemetryDatabase) {
    this.stmts = {
      insertRun: db.prepare(
        `INSERT INTO agent_runs (run_id, trace_id, root_span_id, kind, status, started_at, provider, model, request_id)
         VALUES (:run_id, :trace_id, :root_span_id, :kind, 'running', :started_at, :provider, :model, :request_id)`,
      ),
      finishRun: db.prepare(
        `UPDATE agent_runs SET status = :status, completed_at = :completed_at, duration_ms = :duration_ms,
           error_category = :error_category, error_message = :error_message, model_call_count = :model_call_count,
           tool_call_count = :tool_call_count, tool_error_count = :tool_error_count, retry_count = :retry_count,
           usage_reported_calls = :usage_reported_calls, input_tokens = :input_tokens, output_tokens = :output_tokens,
           total_tokens = :total_tokens, cost_usd = :cost_usd, cost_source = :cost_source,
           model_duration_ms = :model_duration_ms, tool_duration_ms = :tool_duration_ms
         WHERE run_id = :run_id`,
      ),
      insertSpan: db.prepare(
        `INSERT INTO agent_spans (span_id, run_id, trace_id, parent_span_id, seq, kind, name, status, started_at, duration_ms,
           model, tool, input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens, cost_usd, cost_source,
           attempts, provider_request_id, error_category, error_message, metadata)
         VALUES (:span_id, :run_id, :trace_id, :parent_span_id, :seq, :kind, :name, :status, :started_at, :duration_ms,
           :model, :tool, :input_tokens, :output_tokens, :total_tokens, :cached_input_tokens, :reasoning_tokens, :cost_usd, :cost_source,
           :attempts, :provider_request_id, :error_category, :error_message, :metadata)`,
      ),
      insertLog: db.prepare(
        `INSERT INTO application_logs (ts, level, level_num, component, message, run_id, trace_id, request_id, error_category, duration_ms, context)
         VALUES (:ts, :level, :level_num, :component, :message, :run_id, :trace_id, :request_id, :error_category, :duration_ms, :context)`,
      ),
      getRun: db.prepare("SELECT * FROM agent_runs WHERE run_id = ?"),
      getRunByTrace: db.prepare("SELECT * FROM agent_runs WHERE trace_id = ? LIMIT 1"),
      spans: db.prepare("SELECT * FROM agent_spans WHERE run_id = ? ORDER BY seq"),
      runLogs: db.prepare("SELECT * FROM application_logs WHERE run_id = ? OR trace_id = ? ORDER BY id DESC LIMIT ?"),
      interrupt: db.prepare(
        `UPDATE agent_runs SET status = 'interrupted', error_category = 'PROCESS_RESTART',
           error_message = 'The server stopped while this run was in progress.'
         WHERE status = 'running' AND started_at < ?`,
      ),
      sweepRuns: db.prepare("DELETE FROM agent_runs WHERE started_at < ?"),
      sweepLogs: db.prepare("DELETE FROM application_logs WHERE ts < ?"),
      capLogs: db.prepare("DELETE FROM application_logs WHERE id <= (SELECT id FROM application_logs ORDER BY id DESC LIMIT 1 OFFSET ?)"),
      models: db.prepare("SELECT DISTINCT model FROM agent_runs ORDER BY model LIMIT 50"),
      tools: db.prepare("SELECT DISTINCT tool FROM agent_spans WHERE tool IS NOT NULL ORDER BY tool LIMIT 50"),
      components: db.prepare("SELECT DISTINCT component FROM application_logs WHERE component IS NOT NULL ORDER BY component LIMIT 50"),
      counts: db.prepare(
        `SELECT (SELECT COUNT(*) FROM agent_runs) AS runs, (SELECT COUNT(*) FROM agent_spans) AS spans,
                (SELECT COUNT(*) FROM application_logs) AS logs, (SELECT MIN(started_at) FROM agent_runs) AS oldest_run`,
      ),
      ping: db.prepare("SELECT 1 AS ok"),
    };
  }

  insertRun(run: NewRun): void {
    this.stmts.insertRun!.run(run);
  }

  finishRun(runId: string, done: RunCompletion): void {
    this.stmts.finishRun!.run({ ...done, run_id: runId });
  }

  insertSpan(span: SpanRow): void {
    this.stmts.insertSpan!.run(span);
  }

  insertLog(log: NewLog): void {
    this.stmts.insertLog!.run(log);
  }

  getRun(runId: string): RunRow | undefined {
    return this.stmts.getRun!.get(runId) as RunRow | undefined;
  }

  getRunByTrace(traceId: string): RunRow | undefined {
    return this.stmts.getRunByTrace!.get(traceId) as RunRow | undefined;
  }

  spans(runId: string): SpanRow[] {
    return this.stmts.spans!.all(runId) as SpanRow[];
  }

  runLogs(runId: string, traceId: string, limit: number): LogRow[] {
    return this.stmts.runLogs!.all(runId, traceId, limit) as LogRow[];
  }

  /** Runs still `running` from before this process started can never finish. */
  markInterrupted(bootMs: number): number {
    return Number(this.stmts.interrupt!.run(bootMs).changes);
  }

  /** Deletes runs (their spans cascade) and logs older than the cutoff, then caps the log table. */
  sweep(cutoffMs: number, maxLogs: number): { runs: number; logs: number } {
    const runs = Number(this.stmts.sweepRuns!.run(cutoffMs).changes);
    const logs = Number(this.stmts.sweepLogs!.run(cutoffMs).changes) + Number(this.stmts.capLogs!.run(maxLogs).changes);
    return { runs, logs };
  }

  listRuns(filter: RunFilter, sort: RunSort, order: "asc" | "desc", limit: number, offset: number): { rows: RunRow[]; total: number } {
    const { where, params } = runWhere(filter);
    const dir = order === "asc" ? "ASC" : "DESC";
    // Running runs have no duration yet; keep them last either way.
    const orderBy = `${RUN_SORT[sort]} IS NULL, ${RUN_SORT[sort]} ${dir}, started_at DESC`;
    const rows = this.db
      .prepare(`SELECT * FROM agent_runs ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as RunRow[];
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM agent_runs ${where}`).get(...params) as { total: number };
    return { rows, total };
  }

  /** Runs in a window for aggregation, oldest first, at most `limit`. */
  runsInWindow(fromMs: number, toMs: number, kind: string | undefined, limit: number): RunRow[] {
    const { where, params } = runWhere({ fromMs, toMs, kind });
    return this.db.prepare(`SELECT * FROM agent_runs ${where} ORDER BY started_at LIMIT ?`).all(...params, limit) as RunRow[];
  }

  /** Model and tool spans in a window, for the per-tool and per-model tables. */
  spansInWindow(fromMs: number, toMs: number, kind: string | undefined, limit: number): Pick<SpanRow, "kind" | "model" | "tool" | "status" | "duration_ms" | "error_category">[] {
    const kindClause = kind ? "AND r.kind = ?" : "";
    return this.db
      .prepare(
        `SELECT s.kind, s.model, s.tool, s.status, s.duration_ms, s.error_category
         FROM agent_spans s JOIN agent_runs r ON r.run_id = s.run_id
         WHERE s.kind IN ('model', 'tool') AND s.started_at >= ? AND s.started_at < ? ${kindClause}
         ORDER BY s.started_at LIMIT ?`,
      )
      .all(...([fromMs, toMs, ...(kind ? [kind] : []), limit] as SQLInputValue[])) as Pick<
      SpanRow,
      "kind" | "model" | "tool" | "status" | "duration_ms" | "error_category"
    >[];
  }

  listLogs(filter: LogFilter, limit: number): LogRow[] {
    const clauses = ["ts >= ?", "ts < ?"];
    const params: SQLInputValue[] = [filter.fromMs, filter.toMs];
    if (filter.minLevel !== undefined) {
      clauses.push("level_num >= ?");
      params.push(filter.minLevel);
    }
    if (filter.component) {
      clauses.push("component = ?");
      params.push(filter.component);
    }
    if (filter.correlationId) {
      clauses.push("(run_id = ? OR trace_id = ? OR request_id = ?)");
      params.push(filter.correlationId, filter.correlationId, filter.correlationId);
    }
    if (filter.beforeId !== undefined) {
      clauses.push("id < ?");
      params.push(filter.beforeId);
    }
    return this.db
      .prepare(`SELECT * FROM application_logs WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit) as LogRow[];
  }

  options(): { models: string[]; tools: string[]; components: string[] } {
    return {
      models: (this.stmts.models!.all() as { model: string }[]).map((r) => r.model),
      tools: (this.stmts.tools!.all() as { tool: string }[]).map((r) => r.tool),
      components: (this.stmts.components!.all() as { component: string }[]).map((r) => r.component),
    };
  }

  counts(): { runs: number; spans: number; logs: number; oldest_run: number | null } {
    return this.stmts.counts!.get() as { runs: number; spans: number; logs: number; oldest_run: number | null };
  }

  ping(): boolean {
    return (this.stmts.ping!.get() as { ok: number }).ok === 1;
  }
}

function runWhere(filter: RunFilter): { where: string; params: SQLInputValue[] } {
  const clauses = ["started_at >= ?", "started_at < ?"];
  const params: SQLInputValue[] = [filter.fromMs, filter.toMs];
  if (filter.kind) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    clauses.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  }
  if (filter.model) {
    clauses.push("model = ?");
    params.push(filter.model);
  }
  if (filter.tool) {
    clauses.push("EXISTS (SELECT 1 FROM agent_spans s WHERE s.run_id = agent_runs.run_id AND s.tool = ?)");
    params.push(filter.tool);
  }
  if (filter.minDurationMs !== undefined) {
    clauses.push("duration_ms >= ?");
    params.push(filter.minDurationMs);
  }
  if (filter.maxDurationMs !== undefined) {
    clauses.push("duration_ms <= ?");
    params.push(filter.maxDurationMs);
  }
  if (filter.idPrefix) {
    clauses.push("(run_id LIKE ? OR trace_id LIKE ?)");
    params.push(`${filter.idPrefix}%`, `${filter.idPrefix}%`);
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}
