"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, ScanSearchIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { useAgent } from "@components/agent/agent-provider";
import { Button, buttonVariants } from "@components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { SEVERITY_ORDER } from "@constants/anomalies";
import { anomalyQuestion } from "@lib/anomaly-prompt";
import { formatCount, formatDay, formatPct, formatRange, formatUsd } from "@lib/format";
import type { Anomaly } from "@typings/anomalies";
import { cn } from "@lib/utils";
import { AnomalyChart } from "./anomaly-chart";
import { SeverityBadge } from "./severity-badge";

type SortKey = "severity" | "date" | "campaign" | "type" | "change" | "score";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const COLUMNS: { key: SortKey; label: string; align?: "right"; title?: string }[] = [
  { key: "severity", label: "Severity" },
  { key: "date", label: "Day" },
  { key: "campaign", label: "Campaign" },
  { key: "type", label: "Anomaly" },
  { key: "change", label: "Change", align: "right", title: "Against the baseline median" },
  { key: "score", label: "Score", align: "right", title: "Robust z-score: how many usual day-to-day spreads from the median" },
];

const value = (a: Anomaly, n: number) => (a.unit === "usd" ? formatUsd(n) : a.unit === "ratio" ? formatPct(n) : formatCount(n));

function delta(a: Anomaly): string {
  const sign = a.absChange > 0 ? "+" : a.absChange < 0 ? "−" : "";
  const size = Math.abs(a.absChange);
  const abs = a.unit === "usd" ? formatUsd(size) : a.unit === "ratio" ? `${(size * 100).toFixed(1)} pp` : formatCount(size);
  return `${sign}${abs}`;
}

const signedPct = (r: number | null) => (r === null ? "—" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${formatPct(Math.abs(r))}`);

const compare: Record<SortKey, (a: Anomaly, b: Anomaly) => number> = {
  severity: (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity),
  date: (a, b) => a.date.localeCompare(b.date),
  campaign: (a, b) => a.campaign.name.localeCompare(b.campaign.name),
  type: (a, b) => a.typeLabel.localeCompare(b.typeLabel),
  change: (a, b) => Math.abs(a.pctChange ?? 0) - Math.abs(b.pctChange ?? 0),
  score: (a, b) => Math.abs(a.score) - Math.abs(b.score),
};

/** Every flag, sortable; a row opens to the numbers, the rule that fired and the ways to dig in. */
export function AnomalyTable({ anomalies, minScore }: { anomalies: Anomaly[]; minScore: number }) {
  // Starts in the server's order: most severe, newest, furthest from normal.
  const [sort, setSort] = useState<Sort | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { askAgent } = useAgent();

  const rows = sort
    ? [...anomalies].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compare[sort.key](a, b) || a.id.localeCompare(b.id))
    : anomalies;
  const onSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "campaign" || key === "type" ? "asc" : "desc" }));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          {COLUMNS.map((c) => (
            <TableHead
              key={c.key}
              className={cn(c.align === "right" && "text-right")}
              aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
            >
              <button type="button" onClick={() => onSort(c.key)} title={c.title} className="inline-flex items-center gap-1 hover:text-foreground">
                {c.label}
                {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
              </button>
            </TableHead>
          ))}
          <TableHead className="text-right">Observed / baseline</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((a) => {
          const expanded = open.has(a.id);
          return (
            <Fragment key={a.id}>
              <TableRow className="cursor-pointer" onClick={() => toggle(a.id)}>
                <TableCell>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} details for ${a.typeLabel}, ${a.campaign.name}, ${formatDay(a.date)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(a.id);
                    }}
                    className="grid size-5 place-items-center rounded hover:bg-muted"
                  >
                    <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
                  </button>
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={a.severity} />
                </TableCell>
                <TableCell className="tabular-nums">{formatDay(a.date)}</TableCell>
                <TableCell>
                  <div className="font-medium">{a.campaign.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.campaign.channel === "tiktok" ? "TikTok" : "Meta"} · {a.campaign.country}
                  </div>
                </TableCell>
                <TableCell>
                  <div>{a.typeLabel}</div>
                  {a.caveat && <div className="text-xs text-muted-foreground">Capped: see details</div>}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", a.metric !== "spend" && "text-delta-bad")}>{signedPct(a.pctChange)}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.abs(a.score).toFixed(1)}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {value(a, a.observed)} <span className="text-muted-foreground">/ {value(a, a.baseline)}</span>
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="hover:bg-transparent">
                  <TableCell />
                  <TableCell colSpan={COLUMNS.length + 1} className="whitespace-normal">
                    <Details anomaly={a} minScore={minScore} onAsk={() => askAgent(anomalyQuestion(a))} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Details({ anomaly: a, minScore, onAsk }: { anomaly: Anomaly; minScore: number; onAsk: () => void }) {
  const params = new URLSearchParams({ campaign: a.investigate.campaignId, from: a.investigate.from, to: a.investigate.to, run: "1" });
  return (
    <div className="flex min-w-0 max-w-3xl flex-col gap-3 py-2">
      <p className="text-sm leading-relaxed">{a.explanation}</p>
      {a.caveat && <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">{a.caveat}</p>}
      <AnomalyChart anomaly={a} minScore={minScore} />
      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">Metric</dt>
        <dd>
          {a.metricLabel} = {a.definition}
        </dd>
        <dt className="text-muted-foreground">Observed → baseline</dt>
        <dd className="tabular-nums">
          {value(a, a.observed)} against a median of {value(a, a.baseline)} ({delta(a)}, {signedPct(a.pctChange)})
        </dd>
        <dt className="text-muted-foreground">Baseline</dt>
        <dd>
          {a.baselineWindow.days} {a.dayType === "weekend" ? "weekend days" : "weekdays"}, {formatRange(a.baselineWindow)}
        </dd>
        <dt className="text-muted-foreground">Volume on the day</dt>
        <dd>{a.volume}</dd>
        {a.spend && (
          <>
            <dt className="text-muted-foreground">Spend</dt>
            <dd className="tabular-nums">
              {formatUsd(a.spend.observed)} against {formatUsd(a.spend.baseline)} ({signedPct(a.spend.pctChange)})
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Rule</dt>
        <dd>{a.rule}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">A signal to investigate, not a verdict: the numbers say what moved, not why.</p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/investigate?${params}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ScanSearchIcon /> Investigate {formatRange(a.investigate)}
        </Link>
        <Button variant="outline" size="sm" onClick={onAsk}>
          <SparklesIcon /> Ask ADWISE about this
        </Button>
      </div>
    </div>
  );
}
