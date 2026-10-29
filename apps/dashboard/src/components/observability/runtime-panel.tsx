"use client";

import { Loader2Icon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "@components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { RUNTIME_POLL_MS } from "@constants/observability";
import { formatDuration, formatMiB, formatTimestamp, formatUptime, UNAVAILABLE } from "@lib/observability";
import { cn } from "@lib/utils";
import type { RuntimeSample, RuntimeSnapshot } from "@typings/observability";
import { Stat } from "./obs-shared";

const memoryConfig = {
  rss: { label: "RSS", color: "var(--series-1)" },
  heap: { label: "Heap used", color: "var(--series-2)" },
} satisfies ChartConfig;
const MIB = 1024 * 1024;

/**
 * The API process's runtime, refreshed every RUNTIME_POLL_MS while this tab is
 * open and the browser tab is visible. One timer, cleared on unmount.
 */
export function RuntimePanel({ initial }: { initial: RuntimeSnapshot | null }) {
  const [snap, setSnap] = useState(initial);
  const [error, setError] = useState<string | null>(initial ? null : "The API's runtime status couldn't be read.");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/observability/runtime", { cache: "no-store" });
      const body = (await res.json()) as RuntimeSnapshot | { message: string };
      if (!res.ok || "message" in body) throw new Error("message" in body ? body.message : `HTTP ${res.status}`);
      setSnap(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The API's runtime status couldn't be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, RUNTIME_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = (
    <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
      {loading ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />} Refresh
    </Button>
  );

  if (!snap) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Runtime unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <div className="px-4">{refresh}</div>
      </Card>
    );
  }

  const { memory, cpu, eventLoop } = snap;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Measured {formatTimestamp(snap.measuredAt)} · refreshes every {RUNTIME_POLL_MS / 1000} s while open
          {error && <span className="text-delta-bad"> · last refresh failed: {error}</span>}
        </p>
        {refresh}
      </div>

      <section aria-label="Process" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Status"
          value={
            <span className="flex items-center gap-2 text-lg">
              <span className={cn("size-2.5 rounded-full", snap.status === "ok" ? "bg-delta-good" : "bg-delta-bad")} aria-hidden />
              {snap.status === "ok" ? "OK" : "Degraded"}
            </span>
          }
          hint="This process and its checks below"
        />
        <Stat label="Uptime" value={formatUptime(snap.process.uptimeSeconds)} hint={`Since ${formatTimestamp(snap.process.startedAt)}`} />
        <Stat label="Node.js" value={snap.process.nodeVersion} hint={`API ${snap.process.appVersion} · ${snap.process.platform}`} />
        <Stat label="Process id" value={snap.process.pid} hint="One instance; not fleet-wide" />
      </section>

      <section aria-label="Memory" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Heap used" value={formatMiB(memory.heapUsedBytes)} hint={`of ${formatMiB(memory.heapTotalBytes)} V8 heap reserved`} />
        <Stat label="RSS" value={formatMiB(memory.rssBytes)} hint="All memory this process holds in RAM (heap, code, buffers)" />
        <Stat label="External" value={formatMiB(memory.externalBytes)} hint={`Native objects bound to JS; ${formatMiB(memory.arrayBuffersBytes)} array buffers`} />
        <Stat
          label="Memory limit"
          value={memory.constrainedMemoryBytes === null ? "None detected" : formatMiB(memory.constrainedMemoryBytes)}
          muted={memory.constrainedMemoryBytes === null}
          hint="A cgroup limit on this process, if any. Host memory isn't visible here."
        />
      </section>

      <section aria-label="CPU and event loop" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="CPU (process)"
          value={cpu?.percentOfOneCore == null ? "Measuring…" : `${cpu.percentOfOneCore.toFixed(1)}%`}
          muted={cpu?.percentOfOneCore == null}
          hint={cpu ? `Of one core, over the last ${formatDuration(cpu.intervalMs)}` : `First figure ${snap.sampleIntervalMs / 1000} s after boot`}
        />
        <Stat
          label="Event-loop delay p99"
          value={eventLoop?.p99Ms == null ? "Measuring…" : formatDuration(eventLoop.p99Ms)}
          muted={eventLoop?.p99Ms == null}
          hint={eventLoop ? `Median ${formatDuration(eventLoop.p50Ms, "—")}, worst ${formatDuration(eventLoop.maxMs, "—")}` : "monitorEventLoopDelay, per sample"}
        />
        <Stat
          label="Telemetry write failures"
          value={snap.telemetry.runWriteFailures + snap.telemetry.logWriteFailures}
          hint={`${snap.telemetry.runWriteFailures} run/span · ${snap.telemetry.logWriteFailures} log · ${snap.telemetry.logsDroppedOverBudget} over budget, since boot`}
          className={cn(snap.telemetry.runWriteFailures + snap.telemetry.logWriteFailures > 0 && "border-delta-bad/40")}
        />
        <Stat label="Samples in memory" value={snap.samples.length} hint={`One per ${snap.sampleIntervalMs / 1000} s, last ~10 min, reset on restart`} />
      </section>

      <MemoryChart samples={snap.samples} />

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Dependency checks</CardTitle>
          <CardDescription>Run when this page reads the runtime (at most every 5 s). A passing check means a trivial read worked just now.</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last checked</TableHead>
                <TableHead>Last OK</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snap.checks.map((c) => (
                <TableRow key={c.name}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className={cn(c.status === "ok" ? "text-delta-good" : c.status === "failing" ? "text-delta-bad" : "text-muted-foreground")}>
                    {c.status === "ok" ? "OK" : c.status === "failing" ? "Failing" : "Not checked"}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.checkedAt ? formatTimestamp(c.checkedAt) : "—"}</TableCell>
                  <TableCell className="tabular-nums">{c.lastOkAt ? formatTimestamp(c.lastOkAt) : "Never since boot"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(c.latencyMs, "—")}</TableCell>
                  <TableCell className="text-xs text-delta-bad">{c.error ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Everything here is this one API process, read with Node&apos;s own APIs (process.memoryUsage, process.cpuUsage over a measured interval,
        monitorEventLoopDelay). Host, container, disk and network metrics are {UNAVAILABLE.toLowerCase()}: the process can&apos;t observe them and this
        page doesn&apos;t estimate them. With several instances, each would report only itself. The dashboard&apos;s own Next.js process isn&apos;t covered.
      </p>
    </div>
  );
}

function MemoryChart({ samples }: { samples: RuntimeSample[] }) {
  const data = samples.map((s) => ({ at: s.at, rss: s.rssBytes / MIB, heap: s.heapUsedBytes / MIB, cpu: s.cpuPercent }));
  const tick = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Memory over the last few minutes</CardTitle>
        <CardDescription>MiB, one point per sample. Steady growth in heap used between samples, without levelling off, is the pattern to watch for.</CardDescription>
      </CardHeader>
      <div className="px-4">
        {data.length < 2 ? (
          <p className="grid h-48 place-items-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
            Not enough samples yet: they&apos;re taken every 10 s and kept in memory only, so they restart with the process.
          </p>
        ) : (
          <>
            <ul className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
              {Object.entries(memoryConfig).map(([k, v]) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: v.color }} />
                  {v.label}
                </li>
              ))}
            </ul>
            <ChartContainer config={memoryConfig} className="aspect-auto h-48 w-full">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="at" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={tick} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${Math.round(v)}`} />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                    if (!p) return null;
                    return (
                      <div className="min-w-40 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                        <div className="mb-1 font-medium">{formatTimestamp(p.at)}</div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">RSS</span>{p.rss.toFixed(1)} MiB</div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Heap used</span>{p.heap.toFixed(1)} MiB</div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">CPU</span>{p.cpu === null ? "—" : `${p.cpu.toFixed(1)}%`}</div>
                      </div>
                    );
                  }}
                />
                <Line dataKey="rss" stroke="var(--color-rss)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="heap" stroke="var(--color-heap)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          </>
        )}
      </div>
    </Card>
  );
}
