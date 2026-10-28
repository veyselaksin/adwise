import "server-only";
import { getCatalog, queryMetrics } from "@/lib/api";
import { apiFilters, type DashboardFilters } from "@/lib/filters";
import { addDays, formatRange } from "@/lib/format";
import { indexDefs } from "@/lib/metrics";
import type { DateRange, MetricKey, MetricsQuery, MetricsResult } from "@/lib/types";
import type { KpiTile } from "./kpi-grid";

const KPI_METRICS: MetricKey[] = [
  "spend",
  "installs",
  "trials",
  "subscriptions",
  "cac",
  "cost_per_trial",
  "trial_to_sub",
  "d7_roas",
];

/** Fetches everything the overview needs, in parallel, for the filters in the URL. */
export async function loadDashboard(filters: DashboardFilters) {
  const catalog = await getCatalog();
  const defs = indexDefs(catalog.metrics);
  const range: DateRange =
    filters.preset === "custom" && filters.range
      ? clampToData(filters.range, catalog.firstDataDate, catalog.lastDataDate)
      : catalog.presets.find((p) => p.key === filters.preset)!.range;
  const scope = apiFilters(filters);
  const q = (query: Omit<MetricsQuery, "filters" | "range">, r: DateRange = range) =>
    queryMetrics({ ...query, range: r, filters: scope });

  // A metric's "final part" of the range: up to its last final day.
  const finalRange = (metric: MetricKey): DateRange | null => {
    const to = defs[metric].lastFinalDate;
    if (to >= range.to) return range;
    return to >= range.from ? { from: range.from, to } : null;
  };
  const finalTos = [...new Set(KPI_METRICS.map(finalRange).filter((r): r is DateRange => !!r && r.to !== range.to).map((r) => r.to))];
  const cacRange = finalRange("cac") ?? range;

  const split = filters.split === "none" ? [] : [filters.split];
  const [summary, series, countries, campaigns, adsets, ads, ...clamped] = await Promise.all([
    q({ compare: true }),
    q({ groupBy: ["date", ...split] }),
    q({ groupBy: ["country", "channel"] }, cacRange),
    q({ groupBy: ["campaign"] }),
    q({ groupBy: ["adset"] }),
    q({ groupBy: ["ad"] }),
    ...finalTos.map((to) => q({ compare: true }, { from: range.from, to })),
  ]);
  const clampedByTo = new Map(finalTos.map((to, i) => [to, clamped[i]!] as const));

  const tiles = KPI_METRICS.map((key) => kpiTile(key, defs[key], summary, finalRange(key), clampedByTo, range));

  return {
    catalog,
    defs,
    range,
    tiles,
    previousRange: summary.previous?.range,
    series: series.rows,
    countries: { rows: countries.rows, range: cacRange, excluded: excludedPart(range, cacRange) },
    drilldown: { campaigns: campaigns.rows, adsets: adsets.rows, ads: ads.rows },
  };
}

function kpiTile(
  key: MetricKey,
  def: ReturnType<typeof indexDefs>[MetricKey],
  summary: MetricsResult,
  final: DateRange | null,
  clampedByTo: Map<string, MetricsResult>,
  range: DateRange,
): KpiTile {
  const current = summary.totals[key];
  const previous = summary.previous?.totals[key] ?? null;
  if (!summary.totals.provisional.includes(key)) return { def, value: current, previous };

  // Ratios over a partly-final range: show the final days, compared like for like.
  const clamped = final && final.to !== range.to ? clampedByTo.get(final.to) : undefined;
  if (def.unit !== "count" && clamped && final) {
    return {
      def,
      value: clamped.totals[key],
      previous: clamped.previous?.totals[key] ?? null,
      range: final,
      note: `${formatRange(final)} only; ${formatRange({ from: addDays(final.to, 1), to: range.to })} not final yet.`,
    };
  }

  const reason =
    key === "cac" || key === "subscriptions"
      ? "Subscriptions from installs in the last 3 days are still arriving as trials end. Use cost per trial for these days."
      : key === "d7_roas"
        ? "D7 revenue keeps arriving for 7 days after install."
        : "Trials from the last few days haven't ended yet.";
  return { def, value: current, previous, notFinal: reason };
}

function clampToData(range: DateRange, first: string, last: string): DateRange {
  const from = range.from < first ? first : range.from > last ? last : range.from;
  const to = range.to > last ? last : range.to < from ? from : range.to;
  return { from, to };
}

function excludedPart(range: DateRange, used: DateRange): DateRange | undefined {
  return used.to < range.to ? { from: addDays(used.to, 1), to: range.to } : undefined;
}
