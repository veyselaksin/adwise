import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { formatCount, formatRange, formatUsd } from "@lib/format";
import { cn } from "@lib/utils";
import type { InsightEvidence } from "@typings/insights";
import type { MetricDefs, MetricKey } from "@typings/metrics";

// Columns a metrics row can carry; ids stay in the raw JSON, names are shown.
const DIMENSION_COLUMNS: [string, string][] = [
  ["date", "Day"],
  ["week", "Week of"],
  ["month", "Month"],
  ["channel", "Channel"],
  ["country", "Country"],
  ["campaign_name", "Campaign"],
  ["adset_name", "Ad set"],
  ["ad_name", "Ad"],
  ["creative_type", "Creative"],
  ["ad_status", "Status"],
];

type Row = Record<string, unknown> & { not_final?: string[] };

/**
 * A metric as the agent's tool returned it: money rounded to cents, ratios
 * already in percent (40.1 means 40.1%), counts whole.
 */
function formatToolValue(defs: MetricDefs, key: MetricKey, value: unknown): string {
  if (typeof value !== "number") return "—";
  const unit = defs[key]?.unit;
  if (unit === "usd") return formatUsd(value);
  if (unit === "ratio") return `${value.toFixed(1)}%`;
  return formatCount(value);
}

/** Change against the previous period: percent for money and counts, points for ratios. */
function formatChange(defs: MetricDefs, key: MetricKey, current: unknown, previous: unknown): string | null {
  if (typeof current !== "number" || typeof previous !== "number") return null;
  if (defs[key]?.unit === "ratio") {
    const pts = current - previous;
    return `${pts > 0 ? "+" : ""}${pts.toFixed(1)} pts`;
  }
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

const asRow = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const asRange = (v: unknown) => {
  const r = asRow(v);
  return r && typeof r.from === "string" && typeof r.to === "string" ? { from: r.from, to: r.to } : null;
};

export function EvidenceView({ evidence, defs }: { evidence: InsightEvidence; defs: MetricDefs }) {
  return (
    <article className="rounded-xl border" aria-label={evidence.label}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{evidence.label}</p>
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            {evidence.tool} · step {evidence.id}
          </p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", evidence.ok ? "text-muted-foreground" : "text-destructive")}>
          {evidence.ok ? <CircleCheckIcon className="size-3.5" /> : <CircleAlertIcon className="size-3.5" />}
          {evidence.summary}
        </span>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {evidence.truncated ? (
          <p className="text-xs text-muted-foreground">The output was too large to keep; only the summary above was saved.</p>
        ) : evidence.ok && evidence.tool === "query_metrics" && evidence.data ? (
          <MetricsEvidence data={evidence.data} defs={defs} />
        ) : !evidence.ok ? (
          <p className="text-xs text-muted-foreground">This lookup failed, so the answer couldn&apos;t rely on it.</p>
        ) : null}
        {evidence.data && <RawData data={evidence.data} args={evidence.args} />}
      </div>
    </article>
  );
}

function MetricsEvidence({ data, defs }: { data: Record<string, unknown>; defs: MetricDefs }) {
  const totals = asRow(data.totals);
  const previous = asRow(data.previous);
  const prevTotals = asRow(previous?.totals);
  const range = asRange(data.range);
  const prevRange = asRange(previous?.range);
  const rows = Array.isArray(data.rows) ? data.rows.map(asRow).filter((r): r is Row => !!r) : [];
  const metricKeys = (Object.keys(totals ?? {}) as MetricKey[]).filter((k) => k in defs);
  const dims = DIMENSION_COLUMNS.filter(([key]) => rows.some((r) => typeof r[key] === "string"));
  const finalThrough = asRow(data.final_through);
  const omitted = typeof data.rows_omitted === "number" ? data.rows_omitted : 0;

  return (
    <>
      {totals && (
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground tabular-nums">
            Totals{range && ` · ${formatRange(range)}`}
            {prevRange && ` vs ${formatRange(prevRange)}`}
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {metricKeys.map((key) => {
              const change = prevTotals && formatChange(defs, key, totals[key], prevTotals[key]);
              const notFinal = totals.not_final?.includes(key);
              return (
                <div key={key} className="rounded-lg bg-muted/40 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">
                    {defs[key].label}
                    {notFinal && <span className="ml-1 text-provisional">· not final</span>}
                  </dt>
                  <dd className="text-base font-semibold tabular-nums">{formatToolValue(defs, key, totals[key])}</dd>
                  {prevTotals && (
                    <dd className="text-[0.7rem] text-muted-foreground tabular-nums">
                      was {formatToolValue(defs, key, prevTotals[key])}
                      {change && ` · ${change}`}
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
          {finalThrough && Object.keys(finalThrough).length > 0 && (
            <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
              Final through:{" "}
              {Object.entries(finalThrough)
                .map(([k, day]) => `${defs[k as MetricKey]?.label ?? k} ${String(day)}`)
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && dims.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-xs tabular-nums">
            <TableHeader>
              <TableRow>
                {dims.map(([key, label]) => (
                  <TableHead key={key}>{label}</TableHead>
                ))}
                {metricKeys.map((key) => (
                  <TableHead key={key} className="text-right">
                    {defs[key].label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {dims.map(([key]) => (
                    <TableCell key={key} className="whitespace-nowrap">
                      {typeof row[key] === "string" ? (row[key] as string) : "—"}
                    </TableCell>
                  ))}
                  {metricKeys.map((key) => (
                    <TableCell key={key} className="text-right whitespace-nowrap">
                      {formatToolValue(defs, key, row[key])}
                      {row.not_final?.includes(key) && <span title="Not final yet" className="text-provisional">*</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {omitted > 0 && (
            <p className="border-t px-2 py-1.5 text-[0.7rem] text-muted-foreground">
              {omitted} more rows weren&apos;t shown to the agent; the totals include them.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function RawData({ data, args }: { data: Record<string, unknown>; args: Record<string, unknown> }) {
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
        Call and raw output
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[0.7rem] leading-relaxed">
        {JSON.stringify({ args, output: data }, null, 2)}
      </pre>
    </details>
  );
}
