// One report model behind every export format, built from the same data the
// overview renders, so a file always matches what was on screen.

import type { DashboardData } from "@/components/dashboard/load-dashboard";
import { CHANNELS, COUNTRIES, PRESET_LABELS } from "@/constants/filters.constant";
import { DETAIL_METRICS } from "@/constants/metrics.constant";
import { formatDay, formatRange } from "@/lib/format";
import { change, combineRows } from "@/lib/metrics";
import type { PacingFields } from "@/types/budgets.type";
import type { CellValue, ExportColumn, ExportReport, ExportRow, ExportTable } from "@/types/export.type";
import type { DashboardFilters } from "@/types/filters.type";
import type { MetricKey, MetricRow } from "@/types/metrics.type";

const channelLabel = (value?: string) => CHANNELS.find((c) => c.value === value)?.label ?? value ?? "";
const countryLabel = (value?: string) => COUNTRIES.find((c) => c.value === value)?.label ?? value ?? "";

export function buildReport(data: DashboardData, filters: DashboardFilters, generatedAt = new Date()): ExportReport {
  const { defs, range, catalog } = data;
  const metricColumns = (keys: MetricKey[]): ExportColumn[] =>
    keys.map((key) => ({ key, label: defs[key].label, unit: defs[key].unit }));
  const metricCells = (row: MetricRow, keys: MetricKey[]): ExportRow => ({
    cells: Object.fromEntries(keys.map((k) => [k, row[k]])),
    notFinal: keys.filter((k) => row.provisional.includes(k)),
  });
  const withCells = (base: ExportRow, cells: Record<string, CellValue>): ExportRow => ({
    ...base,
    cells: { ...cells, ...base.cells },
  });

  const pacing = data.drilldown.pacing;
  const paceColumns: ExportColumn[] = [
    { key: "daily_budget", label: "Daily budget", unit: "usd" },
    { key: "avg_daily_spend", label: `Avg daily spend (${pacing.days}d)`, unit: "usd" },
    { key: "pace", label: `Budget pace (${pacing.days}d)`, unit: "ratio" },
    { key: "pacing", label: "Pacing", unit: "text" },
  ];
  const paceCells = (p?: PacingFields): Record<string, CellValue> =>
    p
      ? { daily_budget: p.daily_budget_usd, avg_daily_spend: p.avg_daily_spend, pace: p.pace, pacing: p.pacing.replace("_", " ") }
      : { daily_budget: null, avg_daily_spend: null, pace: null, pacing: null };
  const campaignPace = new Map(pacing.campaigns.map((p) => [p.campaign_id, p]));
  const adsetPace = new Map(pacing.adsets.map((p) => [p.adset_id, p]));

  const kpis: ExportTable = {
    id: "kpis",
    title: "Key metrics",
    description: data.previousRange ? `Compared with ${formatRange(data.previousRange)}.` : undefined,
    columns: [
      { key: "metric", label: "Metric", unit: "text" },
      { key: "value", label: "Value", unit: "text" },
      { key: "previous", label: "Previous period", unit: "text" },
      { key: "change", label: "Change", unit: "text" },
      { key: "covers", label: "Covers", unit: "text" },
      { key: "note", label: "Note", unit: "text" },
    ],
    rows: data.tiles.map((tile) => {
      const delta = tile.notFinal ? null : change(tile.def, tile.value, tile.previous);
      return {
        cells: {
          metric: tile.def.label,
          value: tile.value,
          previous: tile.notFinal ? null : tile.previous,
          change: delta?.text ?? null,
          covers: formatRange(tile.range ?? range),
          note: tile.notFinal ?? tile.note ?? null,
        },
        units: { value: tile.def.unit, previous: tile.def.unit },
        notFinal: tile.notFinal ? ["value"] : [],
      };
    }),
  };

  const split = filters.split === "none" ? null : filters.split;
  const dailyMetrics: MetricKey[] = ["spend", "installs", "trials", "subscriptions", "cac", "cost_per_trial", "trial_to_sub", "d7_roas"];
  const daily: ExportTable = {
    id: "daily",
    title: "By day",
    description: split ? `Split by ${split}.` : undefined,
    columns: [
      { key: "date", label: "Date", unit: "text" },
      ...(split ? [{ key: split, label: split === "channel" ? "Channel" : "Country", unit: "text" as const }] : []),
      ...metricColumns(dailyMetrics),
    ],
    rows: data.series.map((r) =>
      withCells(metricCells(r, dailyMetrics), {
        date: r.date ?? null,
        ...(split === "channel" && { channel: channelLabel(r.channel) }),
        ...(split === "country" && { country: countryLabel(r.country) }),
      }),
    ),
  };

  const countryMetrics: MetricKey[] = ["spend", "subscriptions", "cac", "d7_roas"];
  const { rows: countryRows, range: countryRange, excluded } = data.countries;
  const blended = CHANNELS.filter((c) => countryRows.some((r) => r.channel === c.value)).map((c) => ({
    ...combineRows(countryRows.filter((r) => r.channel === c.value)),
    channel: c.value,
    country: "Blended",
  }));
  const countries: ExportTable = {
    id: "countries",
    title: "Channels within each country",
    description: `${formatRange(countryRange)}.${excluded ? ` ${formatRange(excluded)} left out: CAC isn't final for days less than 4 days old.` : ""}`,
    columns: [
      { key: "country", label: "Country", unit: "text" },
      { key: "channel", label: "Channel", unit: "text" },
      ...metricColumns(countryMetrics),
    ],
    rows: [...COUNTRIES.flatMap((c) => countryRows.filter((r) => r.country === c.value)), ...blended].map((r) =>
      withCells(metricCells(r, countryMetrics), {
        country: r.country === "Blended" ? "Blended" : countryLabel(r.country),
        channel: channelLabel(r.channel),
      }),
    ),
  };

  const { campaigns: campaignRows, adsets: adsetRows, ads: adRows } = data.drilldown;
  const bySpend = (rows: MetricRow[]) => [...rows].sort((a, b) => b.spend - a.spend);
  const campaigns: ExportTable = {
    id: "campaigns",
    title: "Campaigns",
    columns: [
      { key: "campaign", label: "Campaign", unit: "text" },
      { key: "channel", label: "Channel", unit: "text" },
      { key: "country", label: "Country", unit: "text" },
      ...metricColumns(DETAIL_METRICS),
      ...paceColumns,
    ],
    rows: bySpend(campaignRows).map((r) =>
      withCells(metricCells(r, DETAIL_METRICS), {
        campaign: r.campaign_name ?? null,
        channel: channelLabel(r.channel),
        country: r.country ?? null,
        ...paceCells(campaignPace.get(r.campaign_id!)),
      }),
    ),
  };

  const adsets: ExportTable = {
    id: "adsets",
    title: "Ad sets",
    columns: [
      { key: "campaign", label: "Campaign", unit: "text" },
      { key: "adset", label: "Ad set", unit: "text" },
      ...metricColumns(DETAIL_METRICS),
      ...paceColumns,
    ],
    rows: bySpend(adsetRows).map((r) =>
      withCells(metricCells(r, DETAIL_METRICS), {
        campaign: r.campaign_name ?? null,
        adset: r.adset_name ?? null,
        ...paceCells(adsetPace.get(r.adset_id!)),
      }),
    ),
  };

  const ads: ExportTable = {
    id: "ads",
    title: "Ads",
    description: "Ad names repeat across ad sets, so each ad is listed with its ad set.",
    columns: [
      { key: "campaign", label: "Campaign", unit: "text" },
      { key: "adset", label: "Ad set", unit: "text" },
      { key: "ad", label: "Ad", unit: "text" },
      { key: "creative_type", label: "Creative", unit: "text" },
      { key: "status", label: "Status", unit: "text" },
      ...metricColumns(DETAIL_METRICS),
    ],
    rows: bySpend(adRows).map((r) =>
      withCells(metricCells(r, DETAIL_METRICS), {
        campaign: r.campaign_name ?? null,
        adset: r.adset_name ?? null,
        ad: r.ad_name ?? null,
        creative_type: r.creative_type ?? null,
        status: r.ad_status ?? null,
      }),
    ),
  };

  const period = filters.preset === "custom" ? "Custom range" : PRESET_LABELS[filters.preset];
  const fileParts = ["adwise", range.from, range.to, filters.channel, filters.country].filter((p) => p !== "all");

  return {
    title: "ADWISE ad performance",
    generatedAt: generatedAt.toISOString(),
    filters: [
      { label: "Period", value: `${period}: ${formatRange(range)} (${range.from} to ${range.to})` },
      { label: "Channel", value: filters.channel === "all" ? "All channels" : channelLabel(filters.channel) },
      { label: "Country", value: filters.country === "all" ? "All countries" : countryLabel(filters.country) },
    ],
    notes: [
      `Data through ${formatDay(catalog.lastDataDate)} (yesterday).`,
      `CAC is final through ${formatDay(defs.cac.lastFinalDate)}, trial → sub through ${formatDay(defs.trial_to_sub.lastFinalDate)}, D7 ROAS through ${formatDay(defs.d7_roas.lastFinalDate)}. Values that include later days are marked not final.`,
      `Budget pace is average daily spend over ${formatRange(pacing.range)} ÷ the current daily budget, whatever the period above; only today's budget is known.`,
      "Money is USD. CAC = spend ÷ subscriptions; ratios are of sums, never averages of daily ratios.",
    ],
    tables: [kpis, daily, countries, campaigns, adsets, ads],
    fileName: fileParts.join("_").toLowerCase(),
  };
}
