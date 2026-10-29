import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type TelemetryDatabase = DatabaseSync;

/**
 * The server's own telemetry: agent runs, their spans and persisted logs. It
 * lives in a separate SQLite file (TELEMETRY_PATH) because the case data is
 * read-only and must stay that way; the JSON-file stores (rules, pins) suit a
 * few hand-edited records, not an append-heavy, indexed history.
 *
 * node:sqlite is built into Node, so this adds no dependency. One process
 * writes it; WAL lets the observability queries read while the agent writes.
 */
export function openTelemetryDatabase(path: string): TelemetryDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;");
  migrate(db);
  return db;
}

/**
 * Ordered, append-only migrations. `user_version` records how many have run,
 * so booting again applies nothing and an older file is brought up to date.
 * Never edit a released migration; add the next one.
 */
const MIGRATIONS = [
  `
  CREATE TABLE agent_runs (
    run_id               TEXT PRIMARY KEY,
    trace_id             TEXT NOT NULL,
    root_span_id         TEXT NOT NULL,
    kind                 TEXT NOT NULL,
    status               TEXT NOT NULL,
    started_at           INTEGER NOT NULL,
    completed_at         INTEGER,
    duration_ms          REAL,
    provider             TEXT NOT NULL,
    model                TEXT NOT NULL,
    request_id           TEXT,
    error_category       TEXT,
    error_message        TEXT,
    model_call_count     INTEGER NOT NULL DEFAULT 0,
    tool_call_count      INTEGER NOT NULL DEFAULT 0,
    tool_error_count     INTEGER NOT NULL DEFAULT 0,
    retry_count          INTEGER,
    usage_reported_calls INTEGER NOT NULL DEFAULT 0,
    input_tokens         INTEGER,
    output_tokens        INTEGER,
    total_tokens         INTEGER,
    cost_usd             REAL,
    cost_source          TEXT,
    model_duration_ms    REAL,
    tool_duration_ms     REAL
  );
  CREATE INDEX agent_runs_started_at ON agent_runs (started_at);
  CREATE INDEX agent_runs_status_started_at ON agent_runs (status, started_at);
  CREATE INDEX agent_runs_kind_started_at ON agent_runs (kind, started_at);
  CREATE INDEX agent_runs_trace_id ON agent_runs (trace_id);

  CREATE TABLE agent_spans (
    span_id              TEXT PRIMARY KEY,
    run_id               TEXT NOT NULL REFERENCES agent_runs (run_id) ON DELETE CASCADE,
    trace_id             TEXT NOT NULL,
    parent_span_id       TEXT NOT NULL,
    seq                  INTEGER NOT NULL,
    kind                 TEXT NOT NULL,
    name                 TEXT NOT NULL,
    status               TEXT NOT NULL,
    started_at           INTEGER NOT NULL,
    duration_ms          REAL NOT NULL,
    model                TEXT,
    tool                 TEXT,
    input_tokens         INTEGER,
    output_tokens        INTEGER,
    total_tokens         INTEGER,
    cached_input_tokens  INTEGER,
    reasoning_tokens     INTEGER,
    cost_usd             REAL,
    cost_source          TEXT,
    attempts             INTEGER,
    provider_request_id  TEXT,
    error_category       TEXT,
    error_message        TEXT,
    metadata             TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX agent_spans_run_seq ON agent_spans (run_id, seq);
  CREATE INDEX agent_spans_kind_started_at ON agent_spans (kind, started_at);
  CREATE INDEX agent_spans_tool ON agent_spans (tool, started_at) WHERE tool IS NOT NULL;

  CREATE TABLE application_logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                   INTEGER NOT NULL,
    level                TEXT NOT NULL,
    level_num            INTEGER NOT NULL,
    component            TEXT,
    message              TEXT NOT NULL,
    run_id               TEXT,
    trace_id             TEXT,
    request_id           TEXT,
    error_category       TEXT,
    duration_ms          REAL,
    context              TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX application_logs_ts ON application_logs (ts);
  CREATE INDEX application_logs_level_ts ON application_logs (level_num, ts);
  CREATE INDEX application_logs_run_id ON application_logs (run_id) WHERE run_id IS NOT NULL;
  CREATE INDEX application_logs_trace_id ON application_logs (trace_id) WHERE trace_id IS NOT NULL;
  `,
];

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[i]!);
      // PRAGMA takes no parameters; i is our own loop index.
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export const TELEMETRY_SCHEMA_VERSION = MIGRATIONS.length;
