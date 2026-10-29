"use client";

import { AlertTriangleIcon, CircleSlashIcon, InfoIcon } from "lucide-react";
import { NotFinal } from "@components/dashboard/not-final";
import { assessmentClass, Disclosure, formatDelta, formatSignedPct, formatValue } from "@components/investigation/evidence";
import { Badge } from "@components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { channelName } from "@lib/creatives";
import { formatCount, formatPct, formatRange, formatUsd } from "@lib/format";
import { cn } from "@lib/utils";
import type { ContextMetric, CreativeContext } from "@typings/creatives";

/** The headline tiles; the full table has every metric. */
const TILES = ["spend", "impressions", "ctr", "cpc", "subscriptions", "cac", "d7_roas"];

const NOT_FINAL = "Includes install days too recent to be final; it will still change as trials convert and revenue arrives.";

export function PerformanceSummary({ context }: { context: CreativeContext }) {
  const byKey = new Map(context.metrics.map((m) => [m.key, m]));
  const scope = [context.campaign.name, context.adset?.name, context.ad && `${context.ad.name} (${context.ad.creativeType})`].filter(Boolean).join(" › ");

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Measured performance
          <Badge variant="outline">From the warehouse</Badge>
        </CardTitle>
        <CardDescription>
          <span className="break-words">{scope}</span> · {channelName(context.campaign.channel)} · {context.campaign.country} ·{" "}
          <span className="tabular-nums">
            {formatRange(context.range)} ({context.days} {context.days === 1 ? "day" : "days"})
            {context.comparison.available ? ` vs ${formatRange(context.comparison.range)}` : ""}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {context.status === "insufficient" && (
          <div role="status" className="flex gap-2 rounded-lg border border-provisional/40 bg-provisional/5 px-3 py-2.5 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-provisional" aria-hidden="true" />
            <div>
              <p className="font-medium">Not enough data to inform concepts</p>
              <p className="text-muted-foreground">
                {context.statusReason} Concepts for this selection will be exploratory: built from your brief, with no performance claims.
              </p>
            </div>
          </div>
        )}
        {!context.comparison.available && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> No comparison: {context.comparison.reason}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {TILES.map((key) => byKey.get(key)).filter((m): m is ContextMetric => !!m).map((m) => (
            <Tile key={m.key} m={m} compare={context.comparison.available} />
          ))}
        </dl>

        <Disclosure label="All metrics, with how each is measured">
          <MetricRows metrics={context.metrics} compare={context.comparison.available} />
        </Disclosure>

        {context.topAds.length > 0 && (
          <Disclosure label={`Top ads by spend (${context.topAds.length})`}>
            <AdRows ads={context.topAds} />
          </Disclosure>
        )}

        <Disclosure label="What this data can't tell you">
          <ul className="flex flex-col gap-1.5 text-sm">
            {context.unavailable.map((u) => (
              <li key={u.label} className="flex gap-2">
                <CircleSlashIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="font-medium">{u.label}:</span> <span className="text-muted-foreground">{u.reason}</span>
                </span>
              </li>
            ))}
            {context.notes.map((n) => (
              <li key={n} className="flex gap-2 text-muted-foreground">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {n}
              </li>
            ))}
          </ul>
        </Disclosure>
      </CardContent>
    </Card>
  );
}

function Tile({ m, compare }: { m: ContextMetric; compare: boolean }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
        {m.label}
        <KindMark kind={m.kind} />
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums">
        {m.provisional.current ? <NotFinal reason={NOT_FINAL}>{formatValue(m.unit, m.current)}</NotFinal> : formatValue(m.unit, m.current)}
      </dd>
      {compare && (
        <dd className={cn("text-xs tabular-nums", m.pctChange === null ? "text-muted-foreground" : assessmentClass(m.assessment))}>
          {m.pctChange === null ? "No comparison" : `${formatSignedPct(m.pctChange)} vs before`}
        </dd>
      )}
    </div>
  );
}

function KindMark({ kind }: { kind: ContextMetric["kind"] }) {
  return (
    <span
      className="text-[10px] uppercase tracking-wide"
      title={kind === "observed" ? "Observed: summed straight from the warehouse" : "Calculated: a ratio of the period's sums"}
    >
      {kind === "observed" ? "obs" : "calc"}
    </span>
  );
}

function MetricRows({ metrics, compare }: { metrics: ContextMetric[]; compare: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead>Source</TableHead>
            {compare && <TableHead className="text-right">Previous</TableHead>}
            <TableHead className="text-right">Selected</TableHead>
            {compare && <TableHead className="text-right">Change</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map((m) => (
            <TableRow key={m.key}>
              <TableCell>
                {m.label}
                {!m.inGlossary && (
                  <Badge variant="outline" className="ml-1.5 h-4.5 px-1.5 text-[10px]" title="Not defined in the team glossary">
                    Not in glossary
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{m.kind === "observed" ? "Observed" : `Calculated · ${m.formula}`}</TableCell>
              {compare && (
                <TableCell className="text-right tabular-nums">
                  {m.provisional.previous ? <NotFinal reason={NOT_FINAL}>{formatValue(m.unit, m.previous)}</NotFinal> : formatValue(m.unit, m.previous)}
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums">
                {m.current === null ? (
                  <span className="text-muted-foreground" title="Can't be computed: its denominator is zero for this selection">
                    n/a
                  </span>
                ) : m.provisional.current ? (
                  <NotFinal reason={NOT_FINAL}>{formatValue(m.unit, m.current)}</NotFinal>
                ) : (
                  formatValue(m.unit, m.current)
                )}
              </TableCell>
              {compare && (
                <TableCell className={cn("text-right tabular-nums", assessmentClass(m.assessment))}>
                  {formatDelta(m.unit, m.absChange)} <span className="text-muted-foreground">({formatSignedPct(m.pctChange)})</span>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AdRows({ ads }: { ads: CreativeContext["topAds"] }) {
  return (
    <div className="overflow-x-auto">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead>Ad (ad set)</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">CPI</TableHead>
            <TableHead className="text-right">Subs</TableHead>
            <TableHead className="text-right">CAC</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ads.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                {a.name} <span className="text-muted-foreground">({a.adsetName})</span>
                {a.status !== "active" && <span className="ml-1 text-xs text-muted-foreground">· {a.status}</span>}
              </TableCell>
              <TableCell className="text-xs">{a.creativeType}</TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(a.spend)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPct(a.ctr)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(a.cpi)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(a.subscriptions)}
                {a.smallSample && <span className="ml-1 text-xs text-muted-foreground" title="Fewer than 20 subscriptions">·small</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {a.cacProvisional ? <NotFinal reason={NOT_FINAL}>{formatUsd(a.cac)}</NotFinal> : formatUsd(a.cac)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
