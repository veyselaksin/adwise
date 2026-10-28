"use client";

import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from "recharts";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CHANNELS, CHART_METRICS, COUNTRIES, type DashboardFilters, type Split } from "@/lib/filters";
import { addDays, formatCount, formatDay, formatMetric, formatPct, formatUsdCompact } from "@/lib/format";
import type { MetricDefs } from "@/lib/metrics";
import type { DateRange, MetricRow } from "@/lib/types";
import { useFilterNavigation } from "./use-filter-navigation";

/** Color follows the entity, so a filter never repaints a series. */
const SERIES: Record<string, { label: string; color: string }> = {
  total: { label: "All", color: "var(--series-1)" },
  meta: { label: "Meta", color: "var(--series-1)" },
  tiktok: { label: "TikTok", color: "var(--series-2)" },
  US: { label: "US", color: "var(--series-1)" },
  GB: { label: "GB", color: "var(--series-2)" },
  DE: { label: "DE", color: "var(--series-3)" },
  BR: { label: "BR", color: "var(--series-4)" },
};
const ORDER = { channel: CHANNELS.map((c) => c.value), country: COUNTRIES.map((c) => c.value) } as const;

type Props = {
  filters: DashboardFilters;
  range: DateRange;
  rows: MetricRow[];
  defs: MetricDefs;
};

type Point = { date: string } & Record<string, number | string | null>;

export function TrendChart({ filters, range, rows, defs }: Props) {
  const { update } = useFilterNavigation(filters);
  const def = defs[filters.metric];
  const split: Split = filters.split;
  const lastFinal = def.lastFinalDate;

  const keyOf = (row: MetricRow) =>
    split === "none" ? "total" : String((split === "channel" ? row.channel : row.country) ?? "total");
  const present = new Set(rows.map(keyOf));
  const keys = split === "none" ? ["total"] : ORDER[split].filter((k: string) => present.has(k));

  // One point per day; final values on `<key>`, not-final ones on `<key>_p`
  // (which also repeats the last final point so the dashed line joins up).
  const byDate = new Map<string, Point>();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) byDate.set(d, { date: d });
  for (const row of rows) {
    const point = row.date ? byDate.get(row.date) : undefined;
    if (!point) continue;
    const key = keyOf(row);
    const value = row[filters.metric];
    if (row.date! <= lastFinal) point[key] = value;
    if (row.date! >= lastFinal) point[`${key}_p`] = value;
  }
  const data = [...byDate.values()];
  const firstNotFinal = addDays(lastFinal, 1);
  const hasNotFinal = def.finalAfterDays > 0 && firstNotFinal <= range.to;

  const config = Object.fromEntries(keys.map((k) => [k, SERIES[k] ?? { label: k, color: "var(--series-1)" }])) satisfies ChartConfig;
  const metricItems = CHART_METRICS.map((m) => ({ value: m, label: defs[m].label }));

  const tickFormat = (v: number) =>
    def.unit === "usd" ? formatUsdCompact(v) : def.unit === "ratio" ? formatPct(v) : formatCount(v);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{def.label} by day</CardTitle>
        <CardDescription>
          {def.formula ? `${def.label} = ${def.formula}. ` : ""}
          {hasNotFinal
            ? `Dashed from ${formatDay(firstNotFinal)}: those days are still filling in (final after ${def.finalAfterDays} days).`
            : "All days shown are final."}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Select items={metricItems} value={filters.metric} onValueChange={(v) => v && update({ metric: v })}>
            <SelectTrigger aria-label="Metric" size="sm" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {metricItems.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Split by"
            value={[split]}
            onValueChange={(v: string[]) => v[0] && update({ split: v[0] as Split })}
          >
            <ToggleGroupItem value="channel">Channel</ToggleGroupItem>
            <ToggleGroupItem value="country">Country</ToggleGroupItem>
            <ToggleGroupItem value="none">Total</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>

      <div className="px-4">
        {keys.length > 1 && (
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {keys.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full" style={{ background: config[k]?.color }} />
                {config[k]?.label}
              </li>
            ))}
          </ul>
        )}
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} />
            {hasNotFinal && (
              <ReferenceArea
                x1={lastFinal < range.from ? range.from : lastFinal}
                x2={range.to}
                fill="var(--muted)"
                fillOpacity={0.7}
                ifOverflow="visible"
                label={{ value: "Not final", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
              />
            )}
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={formatDay}
            />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={tickFormat} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, label }) => {
                const point = active ? byDate.get(String(label)) : undefined;
                if (!point) return null;
                const notFinal = point.date > lastFinal;
                return (
                  <div className="min-w-40 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                    <div className="mb-1.5 flex items-center justify-between gap-3 font-medium">
                      {formatDay(point.date)}
                      {notFinal && <span className="font-normal text-provisional">Not final</span>}
                    </div>
                    {keys.map((k) => {
                      const raw = point[k] ?? point[`${k}_p`];
                      return (
                        <div key={k} className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="size-2 rounded-full" style={{ background: config[k]?.color }} />
                            {config[k]?.label}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatMetric(def, typeof raw === "number" ? raw : null)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {keys.flatMap((k) => [
              <Line
                key={k}
                dataKey={k}
                type="monotone"
                stroke={`var(--color-${k})`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
                connectNulls={false}
                isAnimationActive={false}
              />,
              <Line
                key={`${k}_p`}
                dataKey={`${k}_p`}
                type="monotone"
                stroke={`var(--color-${k})`}
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
                connectNulls={false}
                legendType="none"
                isAnimationActive={false}
              />,
            ])}
          </LineChart>
        </ChartContainer>
      </div>
    </Card>
  );
}
