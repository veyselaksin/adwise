import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMetric, formatRange } from "@/lib/format";
import { change } from "@/lib/metrics";
import type { DateRange, MetricDefinition } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NotFinal } from "./not-final";

export type KpiTile = {
  def: MetricDefinition;
  value: number | null;
  previous: number | null;
  /** The period the value covers, when it differs from the selected one. */
  range?: DateRange;
  /** Set when the value itself will still change. */
  notFinal?: string;
  /** Set when the value excludes recent days that aren't final. */
  note?: string;
};

export function KpiGrid({ tiles, previousRange }: { tiles: KpiTile[]; previousRange?: DateRange }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <Kpi key={tile.def.key} tile={tile} previousRange={previousRange} />
      ))}
    </div>
  );
}

function Kpi({ tile, previousRange }: { tile: KpiTile; previousRange?: DateRange }) {
  const { def, value, previous, notFinal, note } = tile;
  const delta = notFinal ? null : change(def, value, previous);
  const Arrow = !delta || delta.direction === 0 ? ArrowRightIcon : delta.direction > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;

  return (
    <Card className="gap-1.5 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground" title={def.formula ? `${def.label} = ${def.formula}` : undefined}>
          {def.label}
        </span>
        {notFinal && <NotFinal reason={notFinal} />}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{formatMetric(def, value)}</div>
      <div className="flex min-h-5 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium tabular-nums",
              delta.sentiment === "good" && "text-delta-good",
              delta.sentiment === "bad" && "text-delta-bad",
            )}
          >
            <Arrow className="size-3.5" aria-hidden="true" />
            {delta.text}
            <span className="sr-only">({delta.sentiment === "neutral" ? "no clear change" : delta.sentiment})</span>
          </span>
        ) : null}
        <span>
          {notFinal
            ? "comparison after the data settles"
            : previous === null
              ? "no prior data"
              : `vs ${formatMetric(def, previous)}${tile.range ? "" : previousRange ? ` · ${formatRange(previousRange)}` : ""}`}
        </span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}
