import { ActivityIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { ApiError, getAnomalies } from "@lib/api";
import { formatDay, formatRange } from "@lib/format";
import { cn } from "@lib/utils";
import { SeverityBadge } from "./severity-badge";

const TOP = 3;

/** The overview's entry to the anomaly monitor: last 14 days, every campaign, top flags. */
export async function AnomalyOverview() {
  let report;
  try {
    report = await getAnomalies({ capped: "hide" });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <Card className="py-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="size-4 text-muted-foreground" aria-hidden="true" /> Anomaly monitor
          </CardTitle>
          <CardDescription>Couldn&apos;t check for anomalies: {err.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { summary, anomalies, range } = report;
  const counts = (["high", "medium", "low"] as const)
    .filter((s) => summary.bySeverity[s] > 0)
    .map((s) => `${summary.bySeverity[s]} ${s}`)
    .join(", ");

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon className="size-4 text-muted-foreground" aria-hidden="true" /> Anomaly monitor · {formatRange(range)}
        </CardTitle>
        <CardDescription>
          {summary.total === 0
            ? `No campaign moved outside its normal range across ${summary.campaignsChecked} campaigns.`
            : `${summary.campaigns.length} of ${summary.campaignsChecked} campaigns need attention (${counts}). Signals to investigate, not causes.`}
          {report.hiddenCapped && report.hiddenCapped.total > 0 && ` ${report.hiddenCapped.total} low flags on still-settling days or small samples are left out.`}
        </CardDescription>
        <CardAction>
          <Link href="/anomalies" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Open monitor <ArrowRightIcon />
          </Link>
        </CardAction>
      </CardHeader>
      {anomalies.length > 0 && (
        <ul className="mx-4 flex flex-col divide-y rounded-lg border">
          {anomalies.slice(0, TOP).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <SeverityBadge severity={a.severity} />
              <span className="font-medium">{a.typeLabel}</span>
              <span className="text-muted-foreground">
                {a.campaign.name} · {formatDay(a.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {anomalies.length > TOP && <p className="px-4 text-xs text-muted-foreground">{anomalies.length - TOP} more in the monitor.</p>}
    </Card>
  );
}
