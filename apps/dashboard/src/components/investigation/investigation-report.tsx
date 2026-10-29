"use client";

import { AlertTriangleIcon, InfoIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { NotFinal } from "@/components/dashboard/not-final";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRange } from "@/lib/format";
import type { Finding, InvestigationFacts, InvestigationState, MetricComparison } from "@/types/investigation.type";
import { cn } from "@/lib/utils";
import {
  assessmentClass,
  DailyTable,
  Disclosure,
  DriverTable,
  EvidenceView,
  evidenceLabel,
  formatDelta,
  formatSignedPct,
  formatValue,
  MetricTable,
  MoversTable,
  ReleaseItem,
} from "./evidence";

/** Errors that only mean "no AI reading": the figures are still complete. */
const SOFT_ERRORS = new Set(["AGENT_DISABLED"]);

export function InvestigationReport({ state }: { state: InvestigationState }) {
  const { facts, interpretation, error } = state;
  const interpreting = state.stages.find((s) => s.key === "interpret")?.status === "running" && state.status === "running";

  if (!facts) {
    if (error) return <ErrorNote error={error} />;
    if (state.status === "stopped") return <p className="text-sm text-muted-foreground">Stopped.</p>;
    return null;
  }

  const metric = (key: MetricComparison["key"]) => facts.metrics.find((m) => m.key === key)!;
  const cacNotFinal = facts.headlineMetric === "cost_per_trial";
  const notes = new Map(interpretation?.releaseNotes.map((n) => [n.release, n.relevance]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{facts.campaign.name}</h2>
        <p className="text-sm text-muted-foreground">
          {facts.campaign.channel === "tiktok" ? "TikTok" : "Meta"} · {facts.campaign.country} · {facts.campaign.status} ·{" "}
          <span className="tabular-nums">
            {formatRange(facts.current.range)} vs {formatRange(facts.previous.range)} ({facts.current.days} days each)
          </span>
        </p>
      </div>

      {error && <ErrorNote error={error} />}

      {facts.status === "insufficient" ? (
        <Card className="items-center gap-2 px-4 py-10 text-center">
          <InfoIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Not enough data to investigate.</p>
          <p className="max-w-xl text-sm text-muted-foreground">{facts.overview} Try another period or campaign.</p>
        </Card>
      ) : (
        <>
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Executive summary
                {interpretation ? (
                  <Badge variant="secondary" className="gap-1">
                    <SparklesIcon className="size-3" aria-hidden="true" /> AI interpretation
                  </Badge>
                ) : (
                  <Badge variant="outline">From the numbers</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-[15px] leading-relaxed">{interpretation?.summary ?? facts.overview}</p>
              {interpreting && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Interpreting the evidence…
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile m={metric("spend")} />
                <Tile m={metric("subscriptions")} />
                <Tile m={metric("cost_per_trial")} />
                <Tile m={metric("cac")} />
              </div>
              {cacNotFinal && (
                <p className="text-sm text-muted-foreground">
                  CAC isn&apos;t final for the selected period (subscriptions arrive for about 4 days after install), so
                  cost per trial is the fair comparison here.
                </p>
              )}
            </CardContent>
          </Card>

          {interpretation && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Findings</CardTitle>
                <CardDescription>
                  Ranked by how much of the change they explain. Open the evidence to see the figures behind each one.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {interpretation.findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    The AI found no finding the evidence supports. The figures below are complete.
                  </p>
                ) : (
                  <ol className="flex flex-col divide-y">
                    {interpretation.findings.map((f, i) => (
                      <FindingItem key={i} rank={i + 1} finding={f} facts={facts} />
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Metric comparison</CardTitle>
              <CardDescription>
                {formatRange(facts.current.range)} against {formatRange(facts.previous.range)}. Colors show whether the
                change is good or bad for that metric; ratios change in percentage points.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MetricTable rows={facts.metrics} />
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>What moved CAC</CardTitle>
              <CardDescription>
                {facts.drivers.available
                  ? `CAC changed ${formatSignedPct(facts.drivers.cacChange)}. CAC = CPM ÷ CTR ÷ click → install ÷ install → subscription, so each funnel step's part of the change can be measured.`
                  : facts.drivers.reason}
              </CardDescription>
            </CardHeader>
            {facts.drivers.available && (
              <CardContent>
                <DriverTable rows={facts.drivers.items} />
              </CardContent>
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Ad sets</CardTitle>
                <CardDescription>
                  Biggest movers ({facts.adsets.rows.length} of {facts.adsets.total}), previous → selected period.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MoversTable rows={facts.adsets.rows} cacNotFinal={cacNotFinal} />
              </CardContent>
            </Card>
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Ads</CardTitle>
                <CardDescription>
                  Biggest movers ({facts.ads.rows.length} of {facts.ads.total}). Ad names repeat across ad sets, so each
                  shows its ad set.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MoversTable rows={facts.ads.rows} cacNotFinal={cacNotFinal} />
              </CardContent>
            </Card>
          </div>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>App releases in these periods</CardTitle>
              <CardDescription>
                Lined up by date only: the ad data has no iOS/Android split, so a release near a change doesn&apos;t
                show it caused it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {facts.releases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No releases shipped in these two periods.</p>
              ) : (
                <ul className="flex flex-col gap-3 divide-y [&>li]:pb-3 [&>li:last-child]:pb-0">
                  {facts.releases.map((r) => (
                    <li key={r.evidenceId}>
                      <ReleaseItem release={r} note={notes.get(r.evidenceId)} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Recommended next steps</CardTitle>
                <CardDescription>Suggestions from the AI to check or try, not verified facts.</CardDescription>
              </CardHeader>
              <CardContent>
                {interpretation && interpretation.nextSteps.length > 0 ? (
                  <ul className="list-disc space-y-1.5 pl-5 text-sm">
                    {interpretation.nextSteps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {interpreting ? "Waiting for the interpretation…" : "No suggestions without an AI interpretation."}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Limitations and uncertainty</CardTitle>
                <CardDescription>What this data can&apos;t tell you, and how firm the numbers are.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 pl-5 text-sm">
                  {facts.limitations.map((l, i) => (
                    <li key={`f${i}`}>{l}</li>
                  ))}
                  {interpretation?.limitations.map((l, i) => (
                    <li key={`a${i}`}>
                      {l} <span className="text-xs text-muted-foreground">(AI)</span>
                    </li>
                  ))}
                  {interpretation && interpretation.removed > 0 && (
                    <li>
                      {interpretation.removed} AI statement{interpretation.removed === 1 ? " was" : "s were"} left out
                      because {interpretation.removed === 1 ? "it" : "they"} cited evidence or figures that aren&apos;t in
                      the data.
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Daily figures</CardTitle>
              <CardDescription>Every day of both periods, for checking where in the period things moved.</CardDescription>
            </CardHeader>
            <CardContent>
              <Disclosure label={`Show ${facts.daily.length} days`}>
                <DailyTable rows={facts.daily} />
              </Disclosure>
            </CardContent>
          </Card>

          {state.status === "done" && state.model && (
            <p className="text-xs text-muted-foreground">Interpreted by {state.model}. Figures computed by the server.</p>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ m }: { m: MetricComparison }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        {m.label}
        {m.provisional.current && <NotFinal reason="Includes install days too recent to be final." />}
      </div>
      <div className="text-xl font-semibold tracking-tight tabular-nums">{formatValue(m.unit, m.current)}</div>
      <div className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground tabular-nums">
        <span className={cn("font-medium", assessmentClass(m.assessment))}>
          {m.unit === "ratio" ? formatDelta(m.unit, m.absChange) : formatSignedPct(m.pctChange)}
        </span>
        <span>from {formatValue(m.unit, m.previous)}</span>
      </div>
    </div>
  );
}

const CONFIDENCE = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

function FindingItem({ rank, finding, facts }: { rank: number; finding: Finding; facts: InvestigationFacts }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">{rank}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{finding.title}</span>
          <Badge
            variant={finding.kind === "verified" ? "secondary" : "outline"}
            className="h-4.5 px-1.5 text-[10px]"
            title={finding.kind === "verified" ? "Shown directly by the figures" : "A possible explanation the data can't confirm"}
          >
            {finding.kind === "verified" ? "Verified in data" : "Hypothesis"}
          </Badge>
          <span className="text-xs text-muted-foreground">{CONFIDENCE[finding.confidence]}</span>
        </div>
        {finding.explanation && <p className="text-sm text-muted-foreground">{finding.explanation}</p>}
        <Disclosure label={`Evidence: ${finding.evidence.map((id) => evidenceLabel(id, facts)).join(", ")}`}>
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-2">
            {finding.evidence.map((id) => (
              <EvidenceView key={id} id={id} facts={facts} />
            ))}
          </div>
        </Disclosure>
      </div>
    </li>
  );
}

function ErrorNote({ error }: { error: { code: string; message: string } }) {
  const soft = SOFT_ERRORS.has(error.code);
  const Icon = soft ? InfoIcon : AlertTriangleIcon;
  return (
    <div
      role={soft ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        soft ? "bg-muted/40 text-muted-foreground" : "border-delta-bad/40 text-delta-bad",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{error.message}</span>
    </div>
  );
}
