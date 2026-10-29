"use client";

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@components/ui/chart";
import { formatCount, formatDay, formatPct, formatUsd } from "@lib/format";
import type { Anomaly } from "@typings/anomalies";

type Point = { date: string; value: number | null; flagged: number | null };

/**
 * The flag in context: the campaign's comparable days before it as dots, the
 * baseline median, and the band within `minScore` usual spreads of it. The
 * flagged day sits outside the band; that distance is the score.
 */
export function AnomalyChart({ anomaly: a, minScore }: { anomaly: Anomaly; minScore: number }) {
  const fmt = (n: number) => (a.unit === "usd" ? formatUsd(n) : a.unit === "ratio" ? formatPct(n) : formatCount(n));
  const data: Point[] = [
    ...a.history.map((h) => ({ date: h.date, value: h.value, flagged: null })),
    { date: a.date, value: null, flagged: a.observed },
  ];
  const low = a.baseline - minScore * a.spread;
  const high = a.baseline + minScore * a.spread;
  const values = [...a.history.map((h) => h.value), a.observed, low, high];
  const pad = (Math.max(...values) - Math.min(...values)) * 0.12 || Math.abs(a.baseline) * 0.1 || 1;
  const domain: [number, number] = [Math.max(0, Math.min(...values) - pad), Math.max(...values) + pad];
  const flagColor = a.metric === "spend" ? "var(--foreground)" : "var(--delta-bad)";
  const config = { value: { label: a.metricLabel, color: "var(--muted-foreground)" } } satisfies ChartConfig;
  const days = a.dayType === "weekend" ? "weekend days" : "weekdays";

  return (
    <figure className="flex flex-col gap-1.5">
      <ChartContainer config={config} className="aspect-auto h-44 w-full max-w-3xl">
        <LineChart data={data} margin={{ top: 18, right: 72, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} />
          <ReferenceArea y1={Math.max(domain[0], low)} y2={Math.min(domain[1], high)} fill="var(--muted)" fillOpacity={0.8} ifOverflow="hidden" />
          <ReferenceLine
            y={a.baseline}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: `Median ${fmt(a.baseline)}`, position: "right", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={6} minTickGap={20} tickFormatter={formatDay} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={60} domain={domain} tickFormatter={fmt} tickCount={4} fontSize={11} />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
              if (!p) return null;
              const v = p.flagged ?? p.value;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <div className="font-medium">{formatDay(p.date)}</div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{p.flagged !== null ? "Flagged day" : "Baseline day"}</span>
                    <span className="font-medium tabular-nums">{v === null ? "—" : fmt(v)}</span>
                  </div>
                </div>
              );
            }}
          />
          <Line
            dataKey="value"
            stroke="none"
            dot={{ r: 3.5, fill: "var(--muted-foreground)", stroke: "var(--background)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--background)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            dataKey="flagged"
            stroke="none"
            dot={{ r: 5, fill: flagColor, stroke: "var(--background)", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: flagColor, stroke: "var(--background)", strokeWidth: 2 }}
            label={{ position: "top", fill: "var(--foreground)", fontSize: 11, formatter: (v: unknown) => (typeof v === "number" ? fmt(v) : "") }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <figcaption className="text-xs text-muted-foreground">
        {a.metricLabel} on the {a.history.length} {days} before ({formatDay(a.history[0]?.date ?? a.date)} – {formatDay(a.baselineWindow.to)}), and{" "}
        {formatDay(a.date)} on the right. Shaded: within {minScore} usual spreads of the median, where a day still counts as normal.
      </figcaption>
    </figure>
  );
}
