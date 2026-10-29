import fp from "fastify-plugin";
import { LOG_MAX_ROWS, RETENTION_SWEEP_MS } from "../constants/telemetry.constant.js";
import { TelemetryRepository } from "../database/repositories/telemetry.repository.js";
import { openTelemetryDatabase } from "../database/telemetry.connection.js";
import type { LogSink } from "../lib/log-sink.js";
import { TelemetryService, type TelemetryStore } from "../services/telemetry.service.js";

export type TelemetryOptions = {
  logSink?: LogSink;
  /** Replaces the recorder's writes, e.g. with one that fails in tests. Reads still use the real store. */
  store?: TelemetryStore;
};

declare module "fastify" {
  interface FastifyInstance {
    /** The telemetry file (TELEMETRY_PATH), the server's own writable store. Only repositories should query it. */
    telemetryStore: TelemetryRepository;
    /** Records agent and investigation runs. */
    telemetry: TelemetryService;
    logSink: LogSink | null;
  }
}

/**
 * Opens the telemetry store at boot, marks runs a previous process left
 * `running` as interrupted, and deletes telemetry older than
 * TELEMETRY_RETENTION_DAYS at boot and hourly. The sweep timer is unref'd and
 * cleared on close, so tests and shutdown don't wait for it.
 */
export default fp<TelemetryOptions>(
  async (app, opts) => {
    const db = openTelemetryDatabase(app.config.TELEMETRY_PATH);
    const repo = new TelemetryRepository(db);
    const bootMs = Date.now();

    const interrupted = repo.markInterrupted(bootMs);
    if (interrupted > 0) app.log.warn({ component: "telemetry", interrupted }, "Runs left unfinished by the previous process were marked interrupted");

    const sweep = () => {
      try {
        const removed = repo.sweep(Date.now() - app.config.TELEMETRY_RETENTION_DAYS * 86_400_000, LOG_MAX_ROWS);
        if (removed.runs + removed.logs > 0) app.log.info({ component: "telemetry", ...removed }, "Old telemetry deleted");
      } catch (err) {
        app.log.warn({ component: "telemetry", err }, "Telemetry retention sweep failed");
      }
    };
    sweep();
    const timer = setInterval(sweep, RETENTION_SWEEP_MS);
    timer.unref();

    opts.logSink?.attach(repo);
    app.decorate("telemetryStore", repo);
    app.decorate("telemetry", new TelemetryService(opts.store ?? repo, app.log));
    app.decorate("logSink", opts.logSink ?? null);

    app.addHook("onClose", async () => {
      clearInterval(timer);
      opts.logSink?.attach(null);
      db.close();
    });
  },
  { name: "telemetry", dependencies: ["config"] },
);
