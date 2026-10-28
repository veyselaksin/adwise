import { PinIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, getPinResult, getPins } from "@/lib/api";
import { formatDay, formatMetric, formatRange } from "@/lib/format";
import { change, type MetricDefs } from "@/lib/metrics";
import type { MetricKey, MetricRow, PinResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { UnpinButton } from "./unpin-button";

/** When a pinned call asked for every metric, a tile shows these. */
const DEFAULT_METRICS: MetricKey[] = ["spend", "subscriptions", "cac", "cost_per_trial"];
const MAX_COLUMNS = 4;

/**
 * Agent answers pinned from the agent panel. Each tile re-runs the agent's own
 * lookup now (no model call), so it stays current; tiles ignore the filters above.
 */
export async function PinnedTiles({ defs }: { defs: MetricDefs }) {
  const pins = await getPins();
  if (pins.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <PinIcon className="size-4" aria-hidden="true" />
        Ask ADWISE a question and pin its answer to keep the numbers here, kept up to date.
      </p>
    );
  }
  const tiles = await Promise.all(
    pins.map(async (pin) => {
      try {
        return { pin, tile: await getPinResult(pin.id) };
      } catch (err) {
        if (err instanceof ApiError) return { pin, error: err.message };
        throw err;
      }
    }),
  );

  return (
    <section aria-labelledby="pinned-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pinned-heading" className="text-sm font-semibold">
          Pinned
        </h2>
        <span className="text-xs text-muted-foreground">Live: each tile re-runs its lookup; the filters above don&apos;t apply.</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ pin, tile, error }) => (
          <Card key={pin.id} className="gap-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium" title={pin.title}>
                  {pin.title}
                </h3>
                <p className="truncate text-xs text-muted-foreground" title={pin.label}>
                  {tile ? `${formatRange(tile.result.range)}${tile.result.previous ? ` vs ${formatRange(tile.result.previous.range)}` : ""} · ` : ""}
                  {pin.label}
                </p>
              </div>
              <UnpinButton id={pin.id} title={pin.title} />
            </div>
            {tile ? <TileBody tile={tile} defs={defs} /> : <p className="text-sm text-delta-bad">{error}</p>}
          </Card>
        ))}
      </div>
    </section>
  );
}

function TileBody({ tile, defs }: { tile: PinResult; defs: MetricDefs }) {
  const { result } = tile;
  const asked = tile.metrics.length === Object.keys(defs).length ? DEFAULT_METRICS : tile.metrics;
  const metrics = asked.slice(0, MAX_COLUMNS);

  // No split: the totals, compared with the previous period when the call asked for it.
  if (result.groupBy.length === 0) {
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {metrics.map((key) => {
          const delta = result.previous ? change(defs[key], result.totals[key], result.previous.totals[key]) : null;
          return (
            <div key={key}>
              <dt className="text-xs text-muted-foreground">{defs[key].label}</dt>
              <dd className="flex items-baseline gap-1.5">
                <Value row={result.totals} metric={key} defs={defs} className="text-lg font-semibold" />
                {delta && (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      delta.sentiment === "good" && "text-delta-good",
                      delta.sentiment === "bad" && "text-delta-bad",
                    )}
                  >
                    {delta.text}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <div className="-mx-1">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-7">{result.groupBy.join(" · ")}</TableHead>
            {metrics.map((key) => (
              <TableHead key={key} className="h-7 text-right">
                {defs[key].label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="max-w-40 truncate py-1.5">{rowName(row)}</TableCell>
              {metrics.map((key) => (
                <TableCell key={key} className="py-1.5 text-right">
                  <Value row={row} metric={key} defs={defs} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow className="font-medium">
            <TableCell className="py-1.5">
              Total{tile.rowsOmitted > 0 && <span className="font-normal text-muted-foreground"> (+{tile.rowsOmitted} rows)</span>}
            </TableCell>
            {metrics.map((key) => (
              <TableCell key={key} className="py-1.5 text-right">
                <Value row={result.totals} metric={key} defs={defs} />
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function Value({ row, metric, defs, className }: { row: MetricRow; metric: MetricKey; defs: MetricDefs; className?: string }) {
  const notFinal = row.provisional.includes(metric);
  return (
    <span
      className={cn("tabular-nums", notFinal && "text-provisional underline decoration-dotted underline-offset-4", className)}
      title={notFinal ? `Not final: includes install days less than ${defs[metric].finalAfterDays} days old` : undefined}
    >
      {formatMetric(defs[metric], row[metric])}
    </span>
  );
}

/** How the team names a row: ad sets and ads by name (ads with their ad set), days as dates. */
function rowName(row: MetricRow): string {
  const parts = [
    row.date && formatDay(row.date),
    row.week && `Week of ${formatDay(row.week)}`,
    row.month,
    row.ad_name ? `${row.ad_name} (${row.adset_name})` : row.adset_name ?? row.campaign_name,
    !row.campaign_name && row.channel && (row.channel === "tiktok" ? "TikTok" : "Meta"),
    !row.campaign_name && row.country,
    row.creative_type && !row.ad_name && row.creative_type,
  ].filter(Boolean);
  return parts.join(" · ") || "All";
}
