"use client";

import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { NotFinal } from "@/components/dashboard/not-final";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatDay, formatMetric, formatPct, formatUsd } from "@/lib/format";
import type { BreakdownRow, CacDriver, InvestigationFacts, MetricComparison, ReleaseEvidence, Unit } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------- formatting */

export const formatValue = (unit: Unit, value: number | null) => formatMetric({ unit }, value);

/** A change in the metric's own unit: "+$2.48", "−1.2 pts" for ratios, "+35" for counts. */
export function formatDelta(unit: Unit, delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const size = Math.abs(delta);
  if (unit === "usd") return `${sign}${formatUsd(size)}`;
  if (unit === "ratio") return `${sign}${(size * 100).toFixed(1)} pts`;
  return `${sign}${formatCount(size)}`;
}

export const formatSignedPct = (ratio: number | null) =>
  ratio === null ? "—" : `${ratio > 0 ? "+" : ratio < 0 ? "−" : ""}${formatPct(Math.abs(ratio))}`;

export const assessmentClass = (assessment: "better" | "worse" | null) =>
  cn(assessment === "better" && "text-delta-good", assessment === "worse" && "text-delta-bad");

const NOT_FINAL = "Includes install days too recent to be final: subscriptions and revenue are still arriving.";

/* ------------------------------------------------------------- disclosure */

/** A button that shows or hides `children`; used for evidence and commit lists. */
export function Disclosure({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- tables */

export function MetricTable({ rows }: { rows: MetricComparison[] }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Previous</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">% change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.key}>
            <TableCell>
              <span title={m.formula ? `${m.label} = ${m.formula}` : undefined} className={cn(m.formula && "cursor-help")}>
                {m.label}
              </span>
              {m.formula && <span className="ml-1.5 text-xs text-muted-foreground">{m.formula}</span>}
              {!m.inGlossary && (
                <Badge variant="outline" className="ml-1.5 h-4.5 px-1.5 text-[10px]" title="Not defined in the team glossary">
                  Not in glossary
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Maybe provisional={m.provisional.previous}>{formatValue(m.unit, m.previous)}</Maybe>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Maybe provisional={m.provisional.current}>{formatValue(m.unit, m.current)}</Maybe>
            </TableCell>
            <TableCell className={cn("text-right tabular-nums", assessmentClass(m.assessment))}>{formatDelta(m.unit, m.absChange)}</TableCell>
            <TableCell className={cn("text-right tabular-nums", assessmentClass(m.assessment))}>
              {m.unit === "ratio" ? <span className="text-muted-foreground">{formatSignedPct(m.pctChange)}</span> : formatSignedPct(m.pctChange)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DriverTable({ rows }: { rows: CacDriver[] }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead>Funnel step</TableHead>
          <TableHead className="text-right">Previous</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right" title="What this step alone did to CAC, the other steps held fixed">
            Effect on CAC
          </TableHead>
          <TableHead className="text-right" title="Its part of the CAC change (log scale; the four add up to 100%)">
            Share of change
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.key}>
            <TableCell>{d.label}</TableCell>
            <TableCell className="text-right tabular-nums">{formatValue(d.unit, d.previous)}</TableCell>
            <TableCell className="text-right tabular-nums">
              <Maybe provisional={d.provisional}>{formatValue(d.unit, d.current)}</Maybe>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatSignedPct(d.pctChange)}</TableCell>
            <TableCell className={cn("text-right tabular-nums", d.effectOnCac > 0.0005 ? "text-delta-bad" : d.effectOnCac < -0.0005 && "text-delta-good")}>
              {formatSignedPct(d.effectOnCac)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(d.share)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const pair = (prev: string, cur: string) => (
  <>
    <span className="text-muted-foreground">{prev}</span> → {cur}
  </>
);

export function MoversTable({ rows, cacNotFinal }: { rows: BreakdownRow[]; cacNotFinal: boolean }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-48">Name</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="text-right">Subscriptions</TableHead>
          <TableHead className="text-right">{cacNotFinal ? <NotFinal reason={NOT_FINAL}>CAC</NotFinal> : "CAC"}</TableHead>
          <TableHead className="text-right">Cost per trial</TableHead>
          <TableHead className="text-right" title="This row's part of the campaign's spend change">
            Share of spend Δ
          </TableHead>
          <TableHead className="text-right" title="This row's part of the campaign's subscription change">
            Share of subs Δ
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.evidenceId}>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{r.name}</span>
                {r.adsetName && <span className="text-xs text-muted-foreground">in {r.adsetName}</span>}
                {r.status === "paused" && (
                  <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">
                    Paused
                  </Badge>
                )}
                {r.smallSample && (
                  <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]" title="Fewer than 20 subscriptions in a period: too small to call best or worst">
                    Small sample
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{pair(formatUsd(r.previous.spend), formatUsd(r.current.spend))}</TableCell>
            <TableCell className="text-right tabular-nums">
              {pair(formatCount(r.previous.subscriptions), formatCount(r.current.subscriptions))}
            </TableCell>
            <TableCell className="text-right tabular-nums">{pair(formatUsd(r.previous.cac), formatUsd(r.current.cac))}</TableCell>
            <TableCell className="text-right tabular-nums">
              {pair(formatUsd(r.previous.cost_per_trial), formatUsd(r.current.cost_per_trial))}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(r.spendShareOfChange)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(r.subscriptionShareOfChange)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DailyTable({ rows }: { rows: InvestigationFacts["daily"] }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead>Period</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="text-right">Installs</TableHead>
          <TableHead className="text-right">Trials</TableHead>
          <TableHead className="text-right">Subscriptions</TableHead>
          <TableHead className="text-right">Cost per trial</TableHead>
          <TableHead className="text-right">CAC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.date}>
            <TableCell className="tabular-nums">{formatDay(d.date)}</TableCell>
            <TableCell className="text-muted-foreground">{d.period === "current" ? "Selected" : "Previous"}</TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(d.spend)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCount(d.installs)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCount(d.trials)}</TableCell>
            <TableCell className="text-right tabular-nums">
              <Maybe provisional={d.provisional}>{formatCount(d.subscriptions)}</Maybe>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(d.cost_per_trial)}</TableCell>
            <TableCell className="text-right tabular-nums">
              <Maybe provisional={d.provisional}>{formatUsd(d.cac)}</Maybe>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** "Day 9 of the selected period" or "13 days before it". */
export const releaseTiming = (r: ReleaseEvidence) =>
  r.dayOffset >= 0 ? `day ${r.dayOffset + 1} of the selected period` : `${-r.dayOffset} days before the selected period (in the previous one)`;

export function ReleaseItem({ release, note }: { release: ReleaseEvidence; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {release.platform === "ios" ? "iOS" : "Android"} {release.version}
        </span>
        <span className="text-muted-foreground">
          released {formatDay(release.date)}, {release.released.slice(11)} UTC · {releaseTiming(release)}
        </span>
      </div>
      {note && (
        <p className="text-sm">
          <Badge variant="secondary" className="mr-1.5 h-4.5 px-1.5 text-[10px]">
            AI note
          </Badge>
          {note}
        </p>
      )}
      <Disclosure label={`${release.commits.length} commits`}>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {release.commits.map((c) => (
            <li key={c.hash}>
              <code className="mr-1.5 text-xs text-muted-foreground">{c.hash}</code>
              <span className="font-medium">
                {c.type ?? "change"}
                {c.scope && `(${c.scope})`}:
              </span>{" "}
              {c.title}
              {c.body && <p className="text-xs text-muted-foreground">{c.body}</p>}
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

/** The data behind one evidence id, as the server computed it. */
export function EvidenceView({ id, facts }: { id: string; facts: InvestigationFacts }) {
  const [kind] = id.split(":");
  if (kind === "metric") {
    const m = facts.metrics.find((x) => x.evidenceId === id);
    return m ? <MetricTable rows={[m]} /> : null;
  }
  if (kind === "driver" && facts.drivers.available) {
    const d = facts.drivers.items.find((x) => x.evidenceId === id);
    return d ? <DriverTable rows={[d]} /> : null;
  }
  if (kind === "adset" || kind === "ad") {
    const r = (kind === "adset" ? facts.adsets : facts.ads).rows.find((x) => x.evidenceId === id);
    return r ? <MoversTable rows={[r]} cacNotFinal={facts.headlineMetric === "cost_per_trial"} /> : null;
  }
  if (kind === "release") {
    const r = facts.releases.find((x) => x.evidenceId === id);
    return r ? <ReleaseItem release={r} /> : null;
  }
  if (id === "daily") return <DailyTable rows={facts.daily} />;
  return null;
}

/** Marks a value that isn't final yet. */
function Maybe({ provisional, children }: { provisional: boolean; children: ReactNode }) {
  return provisional ? <NotFinal reason={NOT_FINAL}>{children}</NotFinal> : <>{children}</>;
}

/** Short label for an evidence id, for the chips under a finding. */
export function evidenceLabel(id: string, facts: InvestigationFacts): string {
  const [kind] = id.split(":");
  if (kind === "metric") return facts.metrics.find((m) => m.evidenceId === id)?.label ?? id;
  if (kind === "driver" && facts.drivers.available) return facts.drivers.items.find((d) => d.evidenceId === id)?.label.split(" (")[0] ?? id;
  if (kind === "adset") return `Ad set ${facts.adsets.rows.find((r) => r.evidenceId === id)?.name ?? ""}`;
  if (kind === "ad") {
    const r = facts.ads.rows.find((x) => x.evidenceId === id);
    return r ? `Ad ${r.name} (${r.adsetName})` : id;
  }
  if (kind === "release") {
    const r = facts.releases.find((x) => x.evidenceId === id);
    return r ? `${r.platform === "ios" ? "iOS" : "Android"} ${r.version}` : id;
  }
  return id === "daily" ? "Daily figures" : id;
}
