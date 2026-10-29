import { ANOMALY_DEFAULT_DAYS, ANOMALY_MAX_DAYS, ANOMALY_RULES, ANOMALY_SETTINGS, ANOMALY_TYPES } from "../constants/anomalies.constant.js";
import { ANOMALY_METRICS, detectAnomalies } from "../lib/anomalies.js";
import { addDays, daysBetween, isValidDate } from "../lib/dates.js";
import { AppError } from "../lib/response.js";
import type {
  Anomaly,
  AnomalyMetric,
  AnomalyQuery,
  AnomalyReport,
  AnomalyType,
  CampaignRef,
  CampaignSeries,
  Severity,
} from "../types/anomalies.type.js";
import type { DateRange } from "../types/dates.type.js";
import type { BaseTotals } from "../types/metrics.type.js";
import { BASE_METRICS } from "../constants/metrics.constant.js";
import type { MetricsService } from "./metrics.service.js";

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * The anomaly monitor: daily per-campaign numbers from the metric layer (the same
 * sums and maturity as the dashboard), checked by the fixed rules in
 * `constants/anomalies.constant.ts`. No model is involved.
 */
export class AnomaliesService {
  constructor(private readonly metrics: MetricsService) {}

  /** The checked range: given, or the last ANOMALY_DEFAULT_DAYS days; inside the data either way. */
  resolveRange(q: Pick<AnomalyQuery, "from" | "to">): DateRange {
    const { metrics } = this;
    if (!q.from !== !q.to) throw new AppError(400, "MISSING_RANGE", "Give both `from` and `to`, or neither");
    const range = q.from && q.to ? { from: q.from, to: q.to } : { from: addDays(metrics.lastDataDate, -(ANOMALY_DEFAULT_DAYS - 1)), to: metrics.lastDataDate };
    if (!isValidDate(range.from) || !isValidDate(range.to)) {
      throw new AppError(400, "INVALID_DATE", "Dates must be valid YYYY-MM-DD values");
    }
    if (range.from > range.to) throw new AppError(400, "INVALID_RANGE", "`from` must be on or before `to`");
    if (range.from < metrics.firstDataDate || range.to > metrics.lastDataDate) {
      throw new AppError(
        400,
        "RANGE_OUTSIDE_DATA",
        `The data covers ${metrics.firstDataDate} to ${metrics.lastDataDate}; pick days inside it`,
      );
    }
    if (daysBetween(range.from, range.to) + 1 > ANOMALY_MAX_DAYS) {
      throw new AppError(400, "RANGE_TOO_LONG", `Check at most ${ANOMALY_MAX_DAYS} days at a time`);
    }
    return range;
  }

  async report(q: AnomalyQuery = {}): Promise<AnomalyReport> {
    const { metrics } = this;
    const range = this.resolveRange(q);
    if (q.type && !ANOMALY_TYPES.includes(q.type)) throw new AppError(400, "INVALID_TYPE", `Unknown anomaly type ${q.type}`);

    // The baseline reaches back before the range, as far as the data goes.
    const lookbackFrom = addDays(range.from, -ANOMALY_SETTINGS.lookbackDays);
    const daily = await metrics.query({
      range: { from: lookbackFrom < metrics.firstDataDate ? metrics.firstDataDate : lookbackFrom, to: range.to },
      groupBy: ["date", "campaign", "channel", "country"],
      filters: {
        ...(q.channel && { channels: [q.channel] }),
        ...(q.country && { countries: [q.country] }),
      },
    });

    const byCampaign = new Map<string, CampaignSeries>();
    for (const row of daily.rows) {
      if (!row.campaign_id || !row.date) continue;
      let series = byCampaign.get(row.campaign_id);
      if (!series) {
        const campaign: CampaignRef = {
          id: row.campaign_id,
          name: row.campaign_name ?? row.campaign_id,
          channel: row.channel ?? "",
          country: row.country ?? "",
        };
        series = { campaign, days: new Map() };
        byCampaign.set(row.campaign_id, series);
      }
      series.days.set(row.date, Object.fromEntries(BASE_METRICS.map((m) => [m, row[m]])) as BaseTotals);
    }
    const series = [...byCampaign.values()].sort((a, b) => a.campaign.id.localeCompare(b.campaign.id));

    const finalThrough = (m: AnomalyMetric) => metrics.lastFinalDate(m === "cpc" ? "spend" : m);
    const result = detectAnomalies({
      series,
      range,
      firstDataDate: metrics.firstDataDate,
      finalThrough,
      types: q.type ? [q.type] : undefined,
    });
    const hide = q.capped === "hide";
    const anomalies = hide ? result.anomalies.filter((a) => a.caps.length === 0) : result.anomalies;
    const hidden = hide ? result.anomalies.filter((a) => a.caps.length > 0) : [];

    const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    const byType: Partial<Record<AnomalyType, number>> = {};
    const campaigns = new Map<string, AnomalyReport["summary"]["campaigns"][number]>();
    for (const a of anomalies) {
      bySeverity[a.severity]++;
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      const c = campaigns.get(a.campaign.id) ?? { campaign: a.campaign, count: 0, topSeverity: a.severity, types: [] };
      c.count++;
      if (SEVERITY_RANK[a.severity] < SEVERITY_RANK[c.topSeverity]) c.topSeverity = a.severity;
      if (!c.types.includes(a.type)) c.types.push(a.type);
      campaigns.set(a.campaign.id, c);
    }

    return {
      range,
      filters: { channel: q.channel ?? null, country: q.country ?? null, type: q.type ?? null, capped: q.capped ?? "show" },
      finalThrough: {
        cac: metrics.lastFinalDate("cac"),
        subscriptions: metrics.lastFinalDate("subscriptions"),
        d7_roas: metrics.lastFinalDate("d7_roas"),
      },
      summary: {
        total: anomalies.length,
        bySeverity,
        byType,
        campaigns: [...campaigns.values()].sort(
          (a, b) => SEVERITY_RANK[a.topSeverity] - SEVERITY_RANK[b.topSeverity] || b.count - a.count || a.campaign.id.localeCompare(b.campaign.id),
        ),
        campaignsChecked: series.length,
      },
      coverage: { checks: result.checks, skipped: result.skipped },
      hiddenCapped: hide ? summarizeHidden(hidden) : null,
      method: {
        lookbackDays: ANOMALY_SETTINGS.lookbackDays,
        splitWeekends: ANOMALY_SETTINGS.splitWeekends,
        minBaselineDays: ANOMALY_SETTINGS.minBaselineDays,
        minScore: ANOMALY_SETTINGS.minScore,
        severity: ANOMALY_SETTINGS.severity,
        rules: ANOMALY_TYPES.map((type) => {
          const r = ANOMALY_RULES[type];
          return {
            type,
            label: r.label,
            metric: r.metric,
            definition: ANOMALY_METRICS[r.metric].definition,
            direction: r.direction,
            minChange: r.minChange,
            volume: `${r.volume.min}+ ${r.volume.label}`,
          };
        }),
      },
      anomalies,
    };
  }
}

/** Capped flags left out of the list, grouped: settling ones per day, the rest counted. */
function summarizeHidden(hidden: Anomaly[]): NonNullable<AnomalyReport["hiddenCapped"]> {
  const byDate = new Map<string, { campaigns: Set<string>; metrics: Set<string> }>();
  let smallSample = 0;
  for (const a of hidden) {
    if (!a.caps.includes("settling")) {
      smallSample++;
      continue;
    }
    const day = byDate.get(a.date) ?? { campaigns: new Set(), metrics: new Set() };
    day.campaigns.add(a.campaign.id);
    day.metrics.add(a.metricLabel);
    byDate.set(a.date, day);
  }
  return {
    total: hidden.length,
    settling: [...byDate]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, d]) => ({ date, campaigns: d.campaigns.size, metrics: [...d.metrics].sort() })),
    smallSample,
  };
}
