"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@components/ui/chart";
import { formatBucket, formatCost, formatDuration, NOT_REPORTED } from "@lib/observability";
import type { ObservabilityTimeseries, TimeBucket } from "@typings/observability";

// Outcomes are statuses, so they use the status tokens (always with a legend and labels);
// measures use the categorical series tokens, in fixed order.
const runsConfig = {
  success: { label: "Successful", color: "var(--delta-good)" },
  failed: { label: "Failed", color: "var(--delta-bad)" },
  cancelled: { label: "Cancelled", color: "var(--muted-foreground)" },
} satisfies ChartConfig;
const durationConfig = {
  avgDurationMs: { label: "Run (end to end)", color: "var(--series-1)" },
  avgModelDurationMs: { label: "Model calls", color: "var(--series-2)" },
} satisfies ChartConfig;
const tokensConfig = {
  inputTokens: { label: "Input", color: "var(--series-1)" },
  outputTokens: { label: "Output", color: "var(--series-2)" },
} satisfies ChartConfig;
const costConfig = { cost: { label: "Cost (est.)", color: "var(--series-1)" } } satisfies ChartConfig;

const compact = (n: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

export function OverviewCharts({ series }: { series: ObservabilityTimeseries }) {
  const { buckets, window } = series;
  const tick = (iso: string) => formatBucket(iso, window.bucketMs);
  const hasDurations = buckets.some((b) => b.avgDurationMs !== null);
  const hasTokens = buckets.some((b) => b.inputTokens !== null);
  const hasCost = buckets.some((b) => b.cost !== null);
  const unpriced = buckets.reduce((n, b) => n + b.unpricedRuns, 0);
  const bucketLabel = window.bucketMs >= 86_400_000 ? "day" : window.bucketMs >= 3_600_000 ? `${window.bucketMs / 3_600_000} h` : `${window.bucketMs / 60_000} min`;

  const xAxis = <XAxis dataKey="start" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={tick} />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Runs" description={`Runs started per ${bucketLabel}, by outcome. An empty slot means no runs started then.`} config={runsConfig}>
        <ChartContainer config={runsConfig} className="aspect-auto h-56 w-full">
          <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            {xAxis}
            <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
            <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={tooltip(tick, (b) => [
              ["Successful", b.success],
              ["Failed", b.failed],
              ["Cancelled", b.cancelled],
            ])} />
            <Bar dataKey="success" stackId="runs" fill="var(--color-success)" stroke="var(--background)" strokeWidth={1} maxBarSize={28} />
            <Bar dataKey="failed" stackId="runs" fill="var(--color-failed)" stroke="var(--background)" strokeWidth={1} maxBarSize={28} />
            <Bar dataKey="cancelled" stackId="runs" fill="var(--color-cancelled)" stroke="var(--background)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Duration vs model time"
        description="Average successful run, end to end, against the time its model calls took. The gap is tools, the server and streaming. Same unit, one axis."
        config={durationConfig}
      >
        {hasDurations ? (
          <ChartContainer config={durationConfig} className="aspect-auto h-56 w-full">
            <LineChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              {xAxis}
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={seconds} />
              <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={tooltip(tick, (b) => [
                ["Run (avg)", b.avgDurationMs === null ? "No successful runs" : formatDuration(b.avgDurationMs)],
                ["Model calls (avg)", b.avgModelDurationMs === null ? "—" : formatDuration(b.avgModelDurationMs)],
                ["Slowest run", b.maxDurationMs === null ? "—" : formatDuration(b.maxDurationMs)],
              ])} />
              {/* No connectNulls: a bucket without successful runs stays a gap, not an invented value. */}
              <Line dataKey="avgDurationMs" stroke="var(--color-avgDurationMs)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line dataKey="avgModelDurationMs" stroke="var(--color-avgModelDurationMs)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        ) : (
          <Empty>No successful runs in this window, so there is no duration to chart.</Empty>
        )}
      </ChartCard>

      <ChartCard title="Tokens" description={`Provider-reported tokens per ${bucketLabel}. Output includes reasoning tokens.`} config={tokensConfig}>
        {hasTokens ? (
          <ChartContainer config={tokensConfig} className="aspect-auto h-56 w-full">
            <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              {xAxis}
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
              <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={tooltip(tick, (b) => [
                ["Input", b.inputTokens === null ? NOT_REPORTED : b.inputTokens.toLocaleString("en-US")],
                ["Output", b.outputTokens === null ? NOT_REPORTED : b.outputTokens.toLocaleString("en-US")],
              ])} />
              <Bar dataKey="inputTokens" stackId="t" fill="var(--color-inputTokens)" stroke="var(--background)" strokeWidth={1} maxBarSize={28} />
              <Bar dataKey="outputTokens" stackId="t" fill="var(--color-outputTokens)" stroke="var(--background)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ChartContainer>
        ) : (
          <Empty>No run in this window reported token usage.</Empty>
        )}
      </ChartCard>

      <ChartCard
        title="Model cost"
        description={`USD per ${bucketLabel}: ZenMux's reported cost, or an estimate from configured prices.${unpriced > 0 ? ` ${unpriced} run${unpriced === 1 ? "" : "s"} with unknown cost left out.` : ""}`}
        config={costConfig}
      >
        {hasCost ? (
          <ChartContainer config={costConfig} className="aspect-auto h-56 w-full">
            <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              {xAxis}
              <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatCost(v)} />
              <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={tooltip(tick, (b) => [
                ["Cost (est.)", b.cost === null ? "Unavailable" : formatCost(b.cost)],
                ["Runs with unknown cost", b.unpricedRuns],
              ])} />
              <Bar dataKey="cost" fill="var(--color-cost)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ChartContainer>
        ) : (
          <Empty>No run in this window has a known cost.</Empty>
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, description, config, children }: { title: string; description: string; config: ChartConfig; children: ReactNode }) {
  const keys = Object.keys(config);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <div className="px-4">
        {keys.length > 1 && (
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {keys.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: config[k]?.color }} />
                {config[k]?.label}
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="grid h-56 place-items-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** A tooltip listing the bucket's values as text, so unknowns read as words, not 0. */
function tooltip(tick: (iso: string) => string, rows: (b: TimeBucket) => [string, ReactNode][]) {
  function BucketTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
    const b = active ? (payload?.[0]?.payload as TimeBucket | undefined) : undefined;
    if (!b) return null;
    return (
      <div className="min-w-44 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
        <div className="mb-1.5 flex justify-between gap-3 font-medium">
          {tick(b.start)} <span className="font-normal text-muted-foreground">{b.runs} run{b.runs === 1 ? "" : "s"}</span>
        </div>
        {rows(b).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    );
  }
  return BucketTooltip;
}
