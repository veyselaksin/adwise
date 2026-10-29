"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, ScanSearchIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, useState } from "react";
import { Badge } from "@components/ui/badge";
import { Button, buttonVariants } from "@components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { formatMetric, formatPct, formatRange, formatUsd } from "@lib/format";
import { DETAIL_METRICS } from "@constants/metrics";
import type { BudgetPacing, PacingFields } from "@typings/budgets";
import type { DateRange } from "@typings/dates";
import type { MetricDefs, MetricKey, MetricRow } from "@typings/metrics";
import { cn } from "@lib/utils";
import { ExportMenu } from "./export-menu";

type Sort = { key: MetricKey; dir: "asc" | "desc" };

type Props = {
  campaigns: MetricRow[];
  adsets: MetricRow[];
  ads: MetricRow[];
  pacing: BudgetPacing;
  defs: MetricDefs;
  /** The overview's query string, for the export links. */
  search: string;
  /** The overview's period, which an investigation starts from. */
  range: DateRange;
};

export function DrilldownTable({ campaigns, adsets, ads, pacing, defs, search, range }: Props) {
  const campaignPace = new Map(pacing.campaigns.map((p) => [p.campaign_id, p]));
  const adsetPace = new Map(pacing.adsets.map((p) => [p.adset_id, p]));
  const paceHelp = `Average daily spend over the last ${pacing.days} days (${formatRange(pacing.range)}) ÷ the current daily budget. Flagged outside ${formatPct(pacing.band.under)}–${formatPct(pacing.band.over)}. Ignores the date filter: only today's budget is known, and budgets have changed over time.`;
  const [sort, setSort] = useState<Sort>({ key: "spend", dir: "desc" });
  const [open, setOpen] = useState<Set<string>>(new Set());

  const sorted = (rows: MetricRow[]) =>
    [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      return sort.dir === "asc" ? av - bv : bv - av;
    });
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allIds = [...campaigns.map((c) => c.campaign_id!), ...adsets.map((a) => a.adset_id!)];
  const allOpen = allIds.every((id) => open.has(id));

  const onSort = (key: MetricKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defs[key].better === "lower" ? "asc" : "desc" }));

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Campaigns, ad sets and ads</CardTitle>
        <CardDescription>
          Click a row to drill down; click a column to sort. Values marked{" "}
          <span className="text-provisional underline decoration-dotted underline-offset-4">like this</span> include days
          that aren&apos;t final yet.
        </CardDescription>
        <CardAction className="col-start-1 row-span-1 row-start-auto justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(allIds))}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
          <ExportMenu search={search} tables={["campaigns", "adsets", "ads"]} label="Export campaigns, ad sets and ads" />
        </CardAction>
      </CardHeader>
      <div className="px-4">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">Name</TableHead>
              <TableHead className="text-right">
                <span title={paceHelp} className="cursor-help underline decoration-dotted underline-offset-4">
                  Budget pace ({pacing.days}d)
                </span>
              </TableHead>
              {DETAIL_METRICS.map((key) => (
                <TableHead key={key} className="text-right" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <button
                    type="button"
                    onClick={() => onSort(key)}
                    title={defs[key].formula ? `${defs[key].label} = ${defs[key].formula}` : undefined}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {defs[key].label}
                    {sort.key === key &&
                      (sort.dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.length === 0 && (
              <TableRow>
                <TableCell colSpan={DETAIL_METRICS.length + 2} className="py-8 text-center text-muted-foreground">
                  No ad activity for these filters.
                </TableCell>
              </TableRow>
            )}
            {sorted(campaigns).map((c) => {
              const campaignOpen = open.has(c.campaign_id!);
              return (
                <Fragment key={c.campaign_id}>
                  <Row
                    row={c}
                    defs={defs}
                    level={0}
                    expanded={campaignOpen}
                    onToggle={() => toggle(c.campaign_id!)}
                    pace={campaignPace.get(c.campaign_id!)}
                    name={c.campaign_name!}
                    meta={`${c.channel === "tiktok" ? "TikTok" : "Meta"} · ${c.country}`}
                    action={<InvestigateLink campaignId={c.campaign_id!} name={c.campaign_name!} range={range} search={search} />}
                  />
                  {campaignOpen &&
                    sorted(adsets.filter((a) => a.campaign_id === c.campaign_id)).map((s) => {
                      const adsetOpen = open.has(s.adset_id!);
                      return (
                        <Fragment key={s.adset_id}>
                          <Row
                            row={s}
                            defs={defs}
                            level={1}
                            expanded={adsetOpen}
                            onToggle={() => toggle(s.adset_id!)}
                            pace={adsetPace.get(s.adset_id!)}
                            name={s.adset_name!}
                          />
                          {adsetOpen &&
                            sorted(ads.filter((a) => a.adset_id === s.adset_id)).map((a) => (
                              <Row
                                key={a.ad_id}
                                row={a}
                                defs={defs}
                                level={2}
                                name={a.ad_name!}
                                meta={a.creative_type}
                                paused={a.ad_status === "paused"}
                              />
                            ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

type RowProps = {
  row: MetricRow;
  defs: MetricDefs;
  level: 0 | 1 | 2;
  name: string;
  meta?: string;
  paused?: boolean;
  /** Campaigns and ad sets only; ads have no budget. */
  pace?: PacingFields;
  expanded?: boolean;
  onToggle?: () => void;
  /** A button after the name (campaigns: Investigate). */
  action?: ReactNode;
};

function Row({ row, defs, level, name, meta, paused, pace, expanded, onToggle, action }: RowProps) {
  return (
    <TableRow
      className={cn(level === 0 && "font-medium", level === 2 && "text-muted-foreground", onToggle && "cursor-pointer")}
      onClick={onToggle}
    >
      <TableCell>
        <div className="flex items-center gap-1.5" style={{ paddingLeft: level * 20 }}>
          {onToggle ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="grid size-5 place-items-center rounded hover:bg-muted"
            >
              <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
            </button>
          ) : (
            <span className="size-5" />
          )}
          <span className={cn(level === 2 && "text-foreground")}>{name}</span>
          {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
          {paused && (
            <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">
              Paused
            </Badge>
          )}
          {action}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{pace && <PaceCell pace={pace} />}</TableCell>
      {DETAIL_METRICS.map((key) => {
        const notFinal = row.provisional.includes(key);
        return (
          <TableCell key={key} className="text-right tabular-nums">
            <span
              className={cn(notFinal && "text-provisional underline decoration-dotted underline-offset-4")}
              title={notFinal ? `Not final: includes install days less than ${defs[key].finalAfterDays} days old` : undefined}
            >
              {formatMetric(defs[key], row[key])}
            </span>
          </TableCell>
        );
      })}
    </TableRow>
  );
}

const PACE_LABEL = { over: "Over", under: "Under" } as const;

function PaceCell({ pace }: { pace: PacingFields }) {
  if (pace.pacing === "paused") return <span className="text-muted-foreground">Paused</span>;
  const flag = pace.pacing === "over" || pace.pacing === "under" ? pace.pacing : null;
  return (
    <span
      className="inline-flex items-center justify-end gap-1.5"
      title={`${formatUsd(pace.avg_daily_spend)}/day vs ${formatUsd(pace.daily_budget_usd)} budget; ${formatUsd(pace.last_day_spend)} yesterday`}
    >
      {flag && (
        <Badge
          variant="outline"
          className={cn(
            "h-4.5 px-1.5 text-[10px]",
            flag === "over" && "border-delta-bad/40 text-delta-bad",
          )}
        >
          {PACE_LABEL[flag]}
        </Badge>
      )}
      <span className={cn(flag === "over" && "text-delta-bad")}>
        {formatPct(pace.pace)}
      </span>
      <span className="text-xs text-muted-foreground">of {formatUsd(pace.daily_budget_usd)}</span>
    </span>
  );
}

/** Opens the investigation for this campaign and the overview's period, and starts it. */
function InvestigateLink({ campaignId, name, range, search }: { campaignId: string; name: string; range: DateRange; search: string }) {
  const params = new URLSearchParams({ campaign: campaignId, from: range.from, to: range.to, run: "1" });
  if (search) params.set("back", search.replace(/^\?/, ""));
  return (
    <Link
      href={`/investigate?${params}`}
      onClick={(e) => e.stopPropagation()}
      title={`Investigate why ${name} changed in this period`}
      className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "ml-auto font-normal text-muted-foreground")}
    >
      <ScanSearchIcon /> Investigate
    </Link>
  );
}
