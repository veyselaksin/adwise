import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { OBS_RANGES } from "@constants/observability";
import {
  type ObsState,
  formatCost,
  formatDuration,
  formatRate,
  formatTimestamp,
  NOT_REPORTED,
  obsHref,
  UNAVAILABLE,
} from "@lib/observability";
import { cn } from "@lib/utils";
import type { CallStat, ObservabilitySummary, ObservabilityTimeseries, PeriodStats, RuntimeSnapshot } from "@typings/observability";
import { StateCard } from "./obs-shared";
import { OverviewCharts } from "./overview-charts";

type Props = { state: ObsState; summary: ObservabilitySummary; series: ObservabilityTimeseries; runtime: RuntimeSnapshot | null };

export function Overview({ state, summary, series, runtime }: Props) {
  const { current: c, previous: p } = summary;
  const windowLabel = OBS_RANGES.find((r) => r.value === state.range)!.label.toLowerCase();
  const runsHref = (patch: Partial<ObsState> = {}) => obsHref({ tab: "runs", range: state.range, kind: state.kind, ...patch });
  const failed = c.runs.failure + c.runs.timeout + c.runs.interrupted;

  return (
    <div className="flex flex-col gap-4">
      <ProcessStatus runtime={runtime} />

      {summary.truncated && (
        <p className="rounded-lg border border-provisional/50 px-3 py-2 text-sm text-provisional">
          This window has more runs than one summary reads; the figures cover the oldest ones. Pick a shorter window.
        </p>
      )}

      {c.runs.total === 0 ? (
        <StateCard
          title={`No runs in the ${windowLabel}`}
          body="Runs are recorded as they happen: each question to the agent and each campaign investigation adds one. Ask ADWISE something or pick a longer window, and these figures and charts fill in. Nothing is shown that wasn't measured."
        />
      ) : (
        <>
          <section aria-label="Run KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Runs" value={c.runs.total.toLocaleString("en-US")} href={runsHref()} prev={p && delta(c.runs.total, p.runs.total, "count")} />
            <Kpi label="Successful" value={c.runs.success.toLocaleString("en-US")} href={runsHref({ status: "success" })} hint={running(c)} />
            <Kpi
              label="Failed"
              value={failed.toLocaleString("en-US")}
              href={runsHref({ status: "failed" })}
              hint={failed > 0 ? `${c.runs.failure} errors · ${c.runs.timeout} timeouts · ${c.runs.interrupted} interrupted` : undefined}
              bad={failed > 0}
            />
            <Kpi
              label="Success rate"
              value={formatRate(c.successRate)}
              muted={c.successRate === null}
              hint={c.successRate === null ? "No finished runs to judge" : `${c.runs.cancelled} cancelled not counted`}
              prev={p && pp(c.successRate, p.successRate)}
            />
            <Kpi
              label="Avg duration"
              value={formatDuration(c.avgDurationMs, "No successful runs")}
              muted={c.avgDurationMs === null}
              hint={c.avgModelDurationMs !== null ? `${formatDuration(c.avgModelDurationMs)} of it in model calls` : "Successful runs, end to end"}
              prev={p && delta(c.avgDurationMs, p.avgDurationMs, "ms")}
              href={runsHref({ status: "success", sort: "durationMs", order: "desc" })}
            />
            <Kpi
              label="P95 duration"
              value={c.p95DurationMs === null ? `Needs ${summary.p95MinRuns} runs` : formatDuration(c.p95DurationMs)}
              muted={c.p95DurationMs === null}
              hint={c.p95DurationMs === null ? `${c.runs.success} successful so far; median ${formatDuration(c.p50DurationMs, "n/a")}` : `Median ${formatDuration(c.p50DurationMs)}`}
              href={runsHref({ status: "success", sort: "durationMs", order: "desc" })}
            />
            <Kpi
              label="Tokens (in / out)"
              value={c.tokens.input === null ? NOT_REPORTED : `${compact(c.tokens.input)} / ${compact(c.tokens.output)}`}
              muted={c.tokens.input === null}
              hint={`Provider-reported, ${c.tokens.runsWithUsage} run${c.tokens.runsWithUsage === 1 ? "" : "s"}${c.tokens.runsWithoutUsage ? ` · ${c.tokens.runsWithoutUsage} reported none` : ""}`}
            />
            <Kpi
              label="Model cost (est.)"
              value={formatCost(c.cost.total, "Cost unavailable")}
              muted={c.cost.total === null}
              hint={costHint(c)}
              prev={p && delta(c.cost.total, p.cost.total, "usd")}
            />
          </section>
          {!p && <p className="-mt-2 text-xs text-muted-foreground">No comparison: the window before this one has too few finished runs to compare with.</p>}

          <OverviewCharts series={series} />

          <div className="grid gap-4 lg:grid-cols-2">
            <CallTable title="Tools" description="Every tool call in the window, slowest on average first." rows={summary.tools.map((t) => ({ name: t.tool, ...t }))} minCalls={summary.p95MinRuns} />
            <CallTable title="Model calls" description="Per model: one row per streamed request (a run makes several)." rows={summary.models.map((m) => ({ name: m.model, ...m }))} minCalls={summary.p95MinRuns} />
          </div>
        </>
      )}

      <Definitions />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  href,
  prev,
  muted,
  bad,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  prev?: { text: string; worse: boolean | null } | null;
  muted?: boolean;
  bad?: boolean;
}) {
  const body = (
    <Card className={cn("h-full gap-1 px-4 py-3", href && "transition-colors hover:bg-muted/50")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", muted && "text-base font-medium text-muted-foreground", bad && "text-delta-bad")}>{value}</p>
      {prev && (
        <p className={cn("text-xs tabular-nums", prev.worse === true ? "text-delta-bad" : prev.worse === false ? "text-delta-good" : "text-muted-foreground")}>{prev.text}</p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`${label}: ${value}. Show these runs`}>
      {body}
    </Link>
  ) : (
    body
  );
}

/** "+12% vs previous" for counts, durations and cost; null when either side is unknown or the base is 0. */
function delta(cur: number | null, prev: number | null, unit: "count" | "ms" | "usd"): { text: string; worse: boolean | null } | null {
  if (cur === null || prev === null || prev === 0) return null;
  const change = (cur - prev) / prev;
  const sign = change > 0 ? "+" : "";
  return { text: `${sign}${(change * 100).toFixed(1)}% vs previous`, worse: unit === "count" ? null : change > 0.05 ? true : change < -0.05 ? false : null };
}

/** Success rate change in percentage points. */
function pp(cur: number | null, prev: number | null): { text: string; worse: boolean | null } | null {
  if (cur === null || prev === null) return null;
  const diff = (cur - prev) * 100;
  return { text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts vs previous`, worse: diff < -1 ? true : diff > 1 ? false : null };
}

const running = (c: PeriodStats) => (c.runs.running > 0 ? `${c.runs.running} still running` : undefined);
const compact = (n: number | null) => (n === null ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));

function costHint(c: PeriodStats): string {
  if (c.cost.total === null) return c.cost.unpricedRuns > 0 ? `${c.cost.unpricedRuns} run${c.cost.unpricedRuns === 1 ? "" : "s"} with no reported or priced usage` : "No model calls";
  const parts = [`${c.cost.sources.provider} provider-reported`];
  if (c.cost.sources.estimate + c.cost.sources.mixed > 0) parts.push(`${c.cost.sources.estimate + c.cost.sources.mixed} estimated`);
  if (c.cost.unpricedRuns > 0) parts.push(`${c.cost.unpricedRuns} unknown, left out`);
  return `USD · ${parts.join(" · ")}`;
}

function CallTable({ title, description, rows, minCalls }: { title: string; description: string; rows: (CallStat & { name: string })[]; minCalls: number }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto px-4">
        {rows.length === 0 ? (
          <p className="pb-2 text-sm text-muted-foreground">None in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Avg</TableHead>
                <TableHead className="text-right" title={`Shown from ${minCalls} calls`}>
                  P95
                </TableHead>
                <TableHead className="text-right">Max</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-mono text-xs">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", r.errors > 0 && "text-delta-bad")}>
                    {r.errors} {r.errors > 0 && <span className="text-xs">({formatRate(r.errorRate)})</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(r.avgMs)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{r.p95Ms === null ? "—" : formatDuration(r.p95Ms)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(r.maxMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Card>
  );
}

/** What this process can say about itself; deliberately not "the system is healthy". */
function ProcessStatus({ runtime }: { runtime: RuntimeSnapshot | null }) {
  if (!runtime) {
    return (
      <StateCard
        title="Process status unavailable"
        body="The dashboard couldn't read the API's runtime status. The API may be down or restarting."
        retry
      />
    );
  }
  return (
    <Card className="gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <span className={cn("size-2 rounded-full", runtime.status === "ok" ? "bg-delta-good" : "bg-delta-bad")} aria-hidden />
          API process {runtime.status === "ok" ? "responding" : "degraded"}
        </span>
        {runtime.checks.map((c) => (
          <span key={c.name} className="text-muted-foreground">
            {c.name}:{" "}
            <span className={cn(c.status === "failing" && "text-delta-bad")}>
              {c.status === "ok" ? "reachable" : c.status === "failing" ? "failing" : "not checked"}
            </span>
            {c.lastOkAt ? ` · last OK ${formatTimestamp(c.lastOkAt)}` : ` · never OK since boot`}
          </span>
        ))}
        <Link href="/observability?tab=runtime" className="text-muted-foreground underline-offset-4 hover:underline">
          Runtime details
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        One API process checked just now. This is not a health verdict for the hosting, the network or the model provider.
      </p>
    </Card>
  );
}

function Definitions() {
  return (
    <details className="rounded-xl border px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>A <b>run</b> is one question to the agent or one campaign investigation, recorded from request to the last streamed event.</li>
        <li>
          <b>Success</b> means the run delivered its answer (or interpretation). A 200 response alone isn&apos;t success: a stream that ends in an
          error event is a failure. <b>Success rate</b> = success ÷ (success + failed + timed out + interrupted); runs the user cancelled are left out.
        </li>
        <li><b>Durations</b> are measured on a monotonic clock over successful runs. P95 is the nearest-rank 95th percentile, shown from 20 runs.</li>
        <li><b>Model time</b> is the sum of the run&apos;s model calls; the rest is tools, the server and streaming to the browser.</li>
        <li><b>Tokens</b> are what ZenMux reported per call, summed. A call that reported none counts as {UNAVAILABLE.toLowerCase()}, never 0.</li>
        <li>
          <b>Cost</b> is ZenMux&apos;s reported per-call cost when sent, otherwise an estimate from the configured prices
          (<code>apps/server/src/constants/pricing.constant.ts</code>). A run with any unpriced call has no cost and is left out of the total.
        </li>
        <li>Windows are real time ending now, unlike the ad data&apos;s fixed calendar. Empty chart buckets mean no runs started then.</li>
      </ul>
    </details>
  );
}
