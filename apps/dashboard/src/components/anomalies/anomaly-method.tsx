import { formatDay } from "@lib/format";
import type { AnomalyReport } from "@typings/anomalies";

/** How the flags are made, from the thresholds the server actually used. */
export function AnomalyMethod({ report }: { report: AnomalyReport }) {
  const { method: m, finalThrough } = report;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <details className="group rounded-xl border px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">How detection works</summary>
      <div className="mt-3 flex flex-col gap-3 text-muted-foreground">
        <p>
          Each campaign is compared only with itself. For every day, rule and campaign, the day&apos;s value is set against the
          median of the same campaign&apos;s {m.splitWeekends ? "comparable days (weekdays with weekdays, weekends with weekends)" : "days"}{" "}
          in the {m.lookbackDays} days before it; at least {m.minBaselineDays} are needed. The distance from that median is
          measured in robust z-scores (the median absolute deviation × 1.4826), so a campaign whose numbers always swing needs a
          bigger move to stand out.
        </p>
        <p>
          A flag needs a score of {m.minScore}+ <em>and</em> the rule&apos;s minimum change, on enough volume. Medium needs a score of{" "}
          {m.severity.medium.score}+ and {m.severity.medium.changeMultiple}× the minimum change; high, {m.severity.high.score}+ and{" "}
          {m.severity.high.changeMultiple}×. Flags on under 20 subscriptions (team note 6) or on the newest day the team counts as
          final stay low, with the reason shown.
        </p>
        <p>
          CAC and conversions are only checked through {formatDay(finalThrough.cac)} and D7 ROAS through{" "}
          {formatDay(finalThrough.d7_roas)}, the team&apos;s maturity rule. Spend, CTR and CPC are final the same day.
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {m.rules.map((r) => (
            <li key={r.type}>
              <span className="text-foreground">{r.label}</span>: {r.direction === "up" ? "+" : "−"}
              {pct(r.minChange)} or more, {r.volume}. <span className="text-xs">({r.definition})</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
