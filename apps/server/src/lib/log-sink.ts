import { LOG_WRITE_BUDGET_PER_MINUTE, PINO_LEVELS, TELEMETRY_INTERNAL } from "../constants/telemetry.constant.js";
import type { NewLog } from "../database/repositories/telemetry.repository.js";
import { redactContext, redactString, serializeError } from "./redact.js";

type LogFn = (...args: unknown[]) => void;
type Bindings = { bindings?: () => Record<string, unknown> };

/** Fields lifted into their own columns; everything else goes to `context`. */
const LIFTED = new Set(["component", "runId", "traceId", "reqId", "requestId", "errorCategory", "durationMs", "msg", "telemetry"]);

/**
 * Persists selected server log lines to the telemetry store, from a pino
 * `logMethod` hook, so every `app.log` / `req.log` call site is covered and
 * none has to remember to redact.
 *
 * What is kept: every warn, error and fatal line, and info lines that name a
 * `component` (deliberate application events such as a finished agent run).
 * Fastify's per-request info lines are not kept, so reading the observability
 * pages doesn't fill the log with its own traffic.
 */
export class LogSink {
  private store: { insertLog(log: NewLog): void } | null = null;
  private writing = false;
  private windowStart = 0;
  private written = 0;
  private dropped = 0;
  private failures = 0;

  /** Connects the store once it's open; lines logged before that are only printed. */
  attach(store: { insertLog(log: NewLog): void } | null): void {
    this.store = store;
  }

  stats(): { writeFailures: number; droppedOverBudget: number } {
    return { writeFailures: this.failures, droppedOverBudget: this.dropped };
  }

  /** For `logger.hooks.logMethod`: prints the line as usual, then maybe stores it. */
  hook() {
    const capture = (level: number, args: unknown[], bindings: Record<string, unknown>) => this.capture(level, args, bindings);
    return function logMethod(this: Bindings, args: unknown[], method: LogFn, level: number) {
      method.apply(this, args);
      capture(level, args, this.bindings?.() ?? {});
    };
  }

  capture(level: number, args: unknown[], bindings: Record<string, unknown>): void {
    if (!this.store || this.writing || level < 30) return;
    const [first, second] = args;
    const obj: Record<string, unknown> =
      first instanceof Error ? { err: first } : first && typeof first === "object" ? (first as Record<string, unknown>) : {};
    if (obj.telemetry === TELEMETRY_INTERNAL) return;
    if (level < 40 && typeof obj.component !== "string") return;
    if (!this.withinBudget()) return;

    const err = obj.err instanceof Error ? obj.err : null;
    const message = typeof first === "string" ? first : typeof second === "string" ? second : (err?.message ?? "");
    const context: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (!LIFTED.has(k)) context[k] = k === "err" && err ? serializeError(err) : v;

    this.insert({
      ts: Date.now(),
      level: PINO_LEVELS[level] ?? (level >= 50 ? "error" : "warn"),
      level_num: level,
      component: str(obj.component) ?? (bindings.reqId ? "http" : "server"),
      message: redactString(message || "(no message)"),
      run_id: str(obj.runId),
      trace_id: str(obj.traceId),
      request_id: str(obj.requestId) ?? str(obj.reqId) ?? str(bindings.reqId),
      error_category: str(obj.errorCategory) ?? (typeof obj.code === "string" && /^[A-Z_]+$/.test(obj.code) ? obj.code : null),
      duration_ms: typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs) ? obj.durationMs : null,
      context: JSON.stringify(redactContext(context)),
    });
  }

  private insert(row: NewLog): void {
    this.writing = true;
    try {
      this.store!.insertLog(row);
    } catch {
      // Not logged: logging here would come straight back through this hook. The runtime page shows the count.
      this.failures++;
    } finally {
      this.writing = false;
    }
  }

  /** A per-minute write budget; the first line of the next minute records how many were dropped. */
  private withinBudget(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      const dropped = this.written > LOG_WRITE_BUDGET_PER_MINUTE ? this.written - LOG_WRITE_BUDGET_PER_MINUTE : 0;
      this.windowStart = now;
      this.written = 0;
      if (dropped > 0) {
        this.insert({
          ts: now,
          level: "warn",
          level_num: 40,
          component: "telemetry",
          message: `${dropped} log lines were not stored: over the budget of ${LOG_WRITE_BUDGET_PER_MINUTE} a minute`,
          run_id: null,
          trace_id: null,
          request_id: null,
          error_category: "LOG_BUDGET_EXCEEDED",
          duration_ms: null,
          context: "{}",
        });
      }
    }
    this.written++;
    if (this.written > LOG_WRITE_BUDGET_PER_MINUTE) {
      this.dropped++;
      return false;
    }
    return true;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? redactString(v, 200) : null);
