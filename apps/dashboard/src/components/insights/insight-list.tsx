import { CalendarIcon, DatabaseIcon, MegaphoneIcon } from "lucide-react";
import Link from "next/link";
import { formatRange } from "@lib/format";
import { formatSavedDate, insightPath } from "@lib/insights";
import type { InsightSummary } from "@typings/insights";
import { InsightActions } from "./insight-actions";

export function InsightList({ insights, filtered }: { insights: InsightSummary[]; filtered: boolean }) {
  if (insights.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        {filtered ? (
          <p>No insights match these filters.</p>
        ) : (
          <>
            <p className="font-medium text-foreground">No saved insights yet</p>
            <p className="mt-1">
              Ask ADWISE a question, then click “Save insight” under its answer to keep it here with the data behind it.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Saved insights" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {insights.length} insight{insights.length === 1 ? "" : "s"}
      </p>
      <ol className="divide-y rounded-xl border">
        {insights.map((insight) => (
          <li key={insight.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
            <div className="min-w-0 flex-1">
              <Link href={insightPath(insight.id)} className="font-medium underline-offset-2 hover:underline">
                {insight.title}
              </Link>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{insight.summary}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Saved {formatSavedDate(insight.createdAt)}</span>
                {insight.period && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <CalendarIcon className="size-3" /> {formatRange(insight.period)}
                  </span>
                )}
                {insight.campaigns.length > 0 && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <MegaphoneIcon className="size-3 shrink-0" />
                    <span className="truncate">{insight.campaigns.join(", ")}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <DatabaseIcon className="size-3" /> {insight.evidenceCount} lookup{insight.evidenceCount === 1 ? "" : "s"}
                </span>
              </p>
            </div>
            <InsightActions insight={{ id: insight.id, title: insight.title, mine: insight.mine }} compact />
          </li>
        ))}
      </ol>
    </section>
  );
}
