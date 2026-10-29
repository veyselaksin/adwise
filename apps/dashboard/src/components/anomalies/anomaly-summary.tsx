import { Card } from "@components/ui/card";
import { SEVERITY_LABELS, SEVERITY_ORDER, SKIP_LABELS } from "@constants/anomalies";
import { formatCount, formatRange } from "@lib/format";
import type { AnomalyReport, SkipReason } from "@typings/anomalies";
import { cn } from "@lib/utils";
import { SeverityBadge } from "./severity-badge";

const channelName = (c: string) => (c === "tiktok" ? "TikTok" : "Meta");

/** Counts by severity, the campaigns behind them, and how many checks couldn't run. */
export function AnomalySummary({ report }: { report: AnomalyReport }) {
  const { summary, coverage } = report;
  const skipped = Object.entries(coverage.skipped).filter(([, n]) => n > 0) as [SkipReason, number][];
  const skippedTotal = skipped.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Campaigns to look at" value={`${summary.campaigns.length} of ${summary.campaignsChecked}`} />
        {SEVERITY_ORDER.map((s) => (
          <Tile
            key={s}
            label={`${SEVERITY_LABELS[s]} severity`}
            value={formatCount(summary.bySeverity[s])}
            className={cn(s === "high" && summary.bySeverity.high > 0 && "text-delta-bad")}
          />
        ))}
      </div>

      {summary.campaigns.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Campaigns with anomalies">
          {summary.campaigns.map((c) => (
            <li key={c.campaign.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
              <SeverityBadge severity={c.topSeverity} />
              <span className="font-medium">{c.campaign.name}</span>
              <span className="text-muted-foreground">
                {channelName(c.campaign.channel)} · {c.campaign.country} · {c.count} flag{c.count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {formatCount(coverage.checks)} checks over {formatRange(report.range)} (each campaign × day × rule).
        {skippedTotal > 0 &&
          ` ${formatCount(skippedTotal)} couldn't run: ${skipped.map(([reason, n]) => `${formatCount(n)} ${SKIP_LABELS[reason]}`).join(", ")}.`}
      </p>
    </div>
  );
}

function Tile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <Card className="gap-1 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", className)}>{value}</p>
    </Card>
  );
}
