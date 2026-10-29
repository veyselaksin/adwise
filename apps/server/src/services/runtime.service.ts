import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { version } from "../config/version.js";
import { RUNTIME_SAMPLE_MS, RUNTIME_SAMPLES } from "../constants/telemetry.constant.js";
import { redactString } from "../lib/redact.js";
import type { HealthCheck, RuntimeSample, RuntimeSnapshot } from "../types/observability.type.js";

/**
 * monitorEventLoopDelay's timer period. Its readings include this period (an idle
 * loop reads ~20 ms), so it is subtracted to report the delay beyond it.
 */
const LOOP_RESOLUTION_MS = 20;

/** Checks of the same dependency closer together than this reuse the last result. */
const CHECK_TTL_MS = 5_000;

type Deps = {
  /** Reads the case data (SELECT 1). */
  pingData: () => Promise<void>;
  /** Reads the telemetry file. */
  pingTelemetry: () => boolean;
  /** Write failures the telemetry recorder and log sink have counted. */
  telemetryStats: () => { runWriteFailures: number; logWriteFailures: number; logsDroppedOverBudget: number };
};

/**
 * This process's runtime numbers. Memory is read live from process.memoryUsage();
 * CPU and event-loop delay need an interval, so one cheap sample is taken every
 * RUNTIME_SAMPLE_MS on an unref'd timer (it never keeps the process alive) and the
 * last RUNTIME_SAMPLES are kept in memory. Nothing here describes the host or
 * container: the process can't see them, so the API doesn't claim them.
 */
export class RuntimeService {
  private readonly samples: RuntimeSample[] = [];
  private readonly loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  private timer: NodeJS.Timeout | null = null;
  private lastCpu = process.cpuUsage();
  private lastAt = performance.now();
  private readonly checks: Record<"data" | "telemetry", HealthCheck & { checkedAtMs: number }> = {
    data: { name: "Case database", status: "unknown", checkedAt: null, lastOkAt: null, latencyMs: null, error: null, checkedAtMs: 0 },
    telemetry: { name: "Telemetry store", status: "unknown", checkedAt: null, lastOkAt: null, latencyMs: null, error: null, checkedAtMs: 0 },
  };
  private readonly bootedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

  constructor(private readonly deps: Deps) {}

  /** Starts sampling; call once per process (the telemetry plugin does, and stops it on close). */
  start(): void {
    if (this.timer) return;
    this.loop.enable();
    this.lastCpu = process.cpuUsage();
    this.lastAt = performance.now();
    this.timer = setInterval(() => this.sample(), RUNTIME_SAMPLE_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loop.disable();
  }

  /** One sample: CPU over the time since the last one, and event-loop delay over the same window. */
  sample(): RuntimeSample {
    const now = performance.now();
    const elapsedMs = now - this.lastAt;
    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
    const mem = process.memoryUsage();
    const hasLoop = this.loop.count > 0;
    const sample: RuntimeSample = {
      at: new Date().toISOString(),
      intervalMs: Math.round(elapsedMs),
      // user + system CPU time over wall time; 100 = one core fully busy (it can exceed 100 with worker threads).
      cpuPercent: elapsedMs > 0 ? round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100) : null,
      eventLoopDelayP50Ms: hasLoop ? lag(this.loop.percentile(50)) : null,
      eventLoopDelayP99Ms: hasLoop ? lag(this.loop.percentile(99)) : null,
      eventLoopDelayMaxMs: hasLoop ? lag(this.loop.max) : null,
      heapUsedBytes: mem.heapUsed,
      rssBytes: mem.rss,
    };
    this.loop.reset();
    this.samples.push(sample);
    if (this.samples.length > RUNTIME_SAMPLES) this.samples.shift();
    return sample;
  }

  async snapshot(): Promise<RuntimeSnapshot> {
    await Promise.all([this.checkData(), this.checkTelemetry()]);
    const mem = process.memoryUsage();
    const latest = this.samples.at(-1) ?? null;
    const constrained = process.constrainedMemory();
    const checks: HealthCheck[] = [this.checks.data, this.checks.telemetry].map((c) => ({
      name: c.name,
      status: c.status,
      checkedAt: c.checkedAt,
      lastOkAt: c.lastOkAt,
      latencyMs: c.latencyMs,
      error: c.error,
    }));
    return {
      measuredAt: new Date().toISOString(),
      scope: "process",
      status: checks.every((c) => c.status === "ok") ? "ok" : "degraded",
      process: {
        pid: process.pid,
        startedAt: this.bootedAt,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        appVersion: `v${version}`,
        platform: `${process.platform}/${process.arch}`,
      },
      memory: {
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        rssBytes: mem.rss,
        externalBytes: mem.external,
        arrayBuffersBytes: mem.arrayBuffers,
        // 0 or a huge value means no limit applies to this process.
        constrainedMemoryBytes: constrained > 0 && constrained < Number.MAX_SAFE_INTEGER ? constrained : null,
      },
      cpu: latest && { percentOfOneCore: latest.cpuPercent, intervalMs: latest.intervalMs, measuredAt: latest.at },
      eventLoop: latest && {
        p50Ms: latest.eventLoopDelayP50Ms,
        p99Ms: latest.eventLoopDelayP99Ms,
        maxMs: latest.eventLoopDelayMaxMs,
        intervalMs: latest.intervalMs,
        measuredAt: latest.at,
      },
      sampleIntervalMs: RUNTIME_SAMPLE_MS,
      samples: [...this.samples],
      checks,
      telemetry: this.deps.telemetryStats(),
    };
  }

  private async checkData(): Promise<void> {
    await this.check("data", async () => this.deps.pingData());
  }

  private async checkTelemetry(): Promise<void> {
    await this.check("telemetry", async () => {
      if (!this.deps.pingTelemetry()) throw new Error("Telemetry store returned no row");
    });
  }

  private async check(key: "data" | "telemetry", run: () => Promise<void>): Promise<void> {
    const c = this.checks[key];
    if (Date.now() - c.checkedAtMs < CHECK_TTL_MS) return;
    const t0 = performance.now();
    c.checkedAtMs = Date.now();
    c.checkedAt = new Date(c.checkedAtMs).toISOString();
    try {
      await run();
      c.status = "ok";
      c.lastOkAt = c.checkedAt;
      c.error = null;
    } catch (err) {
      c.status = "failing";
      c.error = redactString(err instanceof Error ? err.message : String(err), 200);
    }
    c.latencyMs = round(performance.now() - t0);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
/** Histogram nanoseconds → ms of delay beyond the sampling period. */
const lag = (ns: number) => round(Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS));
