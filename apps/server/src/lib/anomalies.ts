/**
 * Campaign anomaly detection. Pure and deterministic: the same series give the
 * same flags, in the same order, with no model involved.
 *
 * Each check takes one campaign, one day and one rule, and compares the day's
 * value with the median of the same campaign's comparable days just before it
 * (weekdays with weekdays, weekends with weekends). How far it is from that
 * median is measured in robust z-scores (MAD), so a campaign whose numbers
 * always swing needs a bigger move than one that is steady.
 */
import { ANOMALY_INVESTIGATE_DAYS, ANOMALY_RULES, ANOMALY_SETTINGS, ANOMALY_TYPES } from "../constants/anomalies.constant.js";
import { METRICS } from "../constants/metrics.constant.js";
import type {
  Anomaly,
  AnomalyMetric,
  AnomalyRule,
  AnomalySettings,
  AnomalyType,
  CampaignSeries,
  CapReason,
  DayType,
  DetectionInput,
  DetectionResult,
  Severity,
  SkipReason,
} from "../types/anomalies.type.js";
import type { BaseTotals, Unit } from "../types/metrics.type.js";
import { addDays, daysBetween } from "./dates.js";
import { count, formatValue, pct, shortDay, shortRange, signedPct, usd } from "./format.js";

/** Scales the MAD to a standard deviation for normally distributed data. */
const MAD_SCALE = 1.4826;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const ANOMALY_METRICS: Record<AnomalyMetric, { label: string; definition: string; unit: Unit }> = {
  spend: { label: "Spend", definition: "What the ad network charges, in USD", unit: "usd" },
  subscriptions: { label: "Subscriptions", definition: "New paying users, counted on the install day", unit: "count" },
  cac: { label: "CAC", definition: "Spend ÷ subscriptions", unit: "usd" },
  d7_roas: { label: "D7 ROAS", definition: "D7 revenue ÷ spend", unit: "ratio" },
  ctr: { label: "CTR", definition: "Clicks ÷ impressions", unit: "ratio" },
  cpc: { label: "CPC", definition: "Spend ÷ clicks (not in the glossary; as investigations compute it)", unit: "usd" },
};

/** A day's value of `metric`; null when its denominator is 0. */
export function metricValue(metric: AnomalyMetric, t: BaseTotals): number | null {
  switch (metric) {
    case "spend":
      return t.spend;
    case "subscriptions":
      return t.subscriptions;
    case "cac":
      return t.subscriptions > 0 ? t.spend / t.subscriptions : null;
    case "d7_roas":
      return t.spend > 0 ? t.d7_revenue / t.spend : null;
    case "ctr":
      return t.impressions > 0 ? t.clicks / t.impressions : null;
    case "cpc":
      return t.clicks > 0 ? t.spend / t.clicks : null;
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median and spread of `values`; the spread never falls below `minRelative` × |median|. */
export function robustBaseline(values: number[], minRelative: number) {
  const center = median(values);
  const mad = median(values.map((v) => Math.abs(v - center)));
  return { center, spread: Math.max(MAD_SCALE * mad, minRelative * Math.abs(center)) };
}

export const dayTypeOf = (date: string): DayType => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6 ? "weekend" : "weekday";
};

/** Severity from how far (score) and how much (change) the value moved; settling days stay low. */
export function classify(score: number, change: number, rule: AnomalyRule, settings: AnomalySettings): Severity {
  const s = Math.abs(score);
  const c = Math.abs(change);
  const { high, medium } = settings.severity;
  if (s >= high.score && c >= rule.minChange * high.changeMultiple) return "high";
  if (s >= medium.score && c >= rule.minChange * medium.changeMultiple) return "medium";
  return "low";
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Most severe first, then newest, then furthest from normal; ties by id so the order is stable. */
export function compareAnomalies(a: Anomaly, b: Anomaly): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.date.localeCompare(a.date) ||
    Math.abs(b.score) - Math.abs(a.score) ||
    a.id.localeCompare(b.id)
  );
}

const emptySkips = (): Record<SkipReason, number> => ({
  short_history: 0,
  not_final: 0,
  low_volume: 0,
  no_data: 0,
  flat_baseline: 0,
});

const round = (n: number, digits = 6) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Checks every campaign, day in `range` and rule; returns the flags and what couldn't be checked. */
export function detectAnomalies(input: DetectionInput): DetectionResult {
  const settings = input.settings ?? ANOMALY_SETTINGS;
  const rules = input.rules ?? ANOMALY_RULES;
  const types = input.types?.length ? [...new Set(input.types)] : ANOMALY_TYPES;
  const skipped = emptySkips();
  const found = new Map<string, Anomaly>();
  let checks = 0;

  const dates: string[] = [];
  for (let d = input.range.from; d <= input.range.to; d = addDays(d, 1)) dates.push(d);

  for (const series of input.series) {
    for (const date of dates) {
      for (const type of types) {
        checks++;
        const outcome = check(series, date, type, rules[type], settings, input);
        if (typeof outcome === "string") skipped[outcome]++;
        else if (outcome) found.set(outcome.id, outcome);
      }
    }
  }
  return { anomalies: [...found.values()].sort(compareAnomalies), checks, skipped };
}

/** One check: an anomaly, null when the value is within normal, or why it couldn't run. */
function check(
  { campaign, days }: CampaignSeries,
  date: string,
  type: AnomalyType,
  rule: AnomalyRule,
  settings: AnomalySettings,
  input: DetectionInput,
): Anomaly | SkipReason | null {
  const { metric, volume } = rule;
  const finalThrough = input.finalThrough(metric);
  if (date > finalThrough) return "not_final";

  const day = days.get(date);
  if (!day) return "no_data";
  if (volume.on === "day" && day[volume.field] < volume.min) return "low_volume";
  const observed = metricValue(metric, day);
  if (observed === null) return "low_volume";

  // Comparable days before this one: same day type, a value, and (for day floors) enough volume.
  const dayType = dayTypeOf(date);
  const base: { date: string; totals: BaseTotals; value: number }[] = [];
  for (let back = 1; back <= settings.lookbackDays; back++) {
    const d = addDays(date, -back);
    if (settings.splitWeekends && dayTypeOf(d) !== dayType) continue;
    const totals = days.get(d);
    if (!totals || (volume.on === "day" && totals[volume.field] < volume.min)) continue;
    const value = metricValue(metric, totals);
    if (value !== null) base.push({ date: d, totals, value });
  }
  if (base.length < settings.minBaselineDays) return "short_history";
  if (volume.on === "baseline" && median(base.map((b) => b.totals[volume.field])) < volume.min) return "low_volume";

  const { center, spread } = robustBaseline(
    base.map((b) => b.value),
    settings.minRelativeSpread,
  );
  if (spread === 0 || center === 0) return "flat_baseline";

  const absChange = observed - center;
  const pctChange = absChange / Math.abs(center);
  const score = absChange / spread;
  const sign = rule.direction === "up" ? 1 : -1;
  if (sign * score < settings.minScore || sign * pctChange < rule.minChange) return null;

  // Fewer conversions only stand out when spend held up; otherwise it's just less spend.
  let spend: Anomaly["spend"];
  if (rule.maxSpendDrop !== undefined) {
    const spendBase = median(base.map((b) => b.totals.spend));
    const spendPct = spendBase === 0 ? null : (day.spend - spendBase) / spendBase;
    if (spendPct === null || spendPct < -rule.maxSpendDrop) return null;
    spend = { observed: round(day.spend, 2), baseline: round(spendBase, 2), pctChange: round(spendPct) };
  }

  const matures = METRICS[metric === "cpc" ? "spend" : metric].finalAfterDays > 0;
  const settling = matures && daysBetween(date, finalThrough) < settings.settlingDays;
  const small = rule.smallSample;
  const sampleSize = small && (small.on === "day" ? day[small.field] : median(base.map((b) => b.totals[small.field])));
  const smallSample = !!small && sampleSize! < small.below;
  const caps: CapReason[] = [...(settling ? (["settling"] as const) : []), ...(smallSample ? (["small_sample"] as const) : [])];
  const severity = caps.length > 0 ? "low" : classify(score, pctChange, rule, settings);
  const caveats = [
    ...(settling
      ? [`${shortDay(date)} is the newest day the team counts as final for ${ANOMALY_METRICS[metric].label}, and it is usually still filling in. Check it again tomorrow.`]
      : []),
    ...(smallSample
      ? [`${small.on === "day" ? `Only ${count(sampleSize!)} ${small.field} on the day` : `Only ${count(sampleSize!)} ${small.field} on a typical day`}, under the team's ${small.below}; small samples swing.`]
      : []),
  ];

  const window = { from: base.at(-1)!.date, to: base[0]!.date, days: base.length };
  const def = ANOMALY_METRICS[metric];
  const dayWord = settings.splitWeekends ? (dayType === "weekend" ? "weekend days" : "weekdays") : "days";
  const fmt = (v: number) => formatValue(def.unit, v);
  const explanation = [
    `${def.label} was ${fmt(observed)} on ${shortDay(date)} (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}),`,
    `${pct(Math.abs(pctChange))} ${pctChange > 0 ? "above" : "below"} the median of ${fmt(center)}`,
    `over ${base.length} ${dayWord} (${shortRange(window)}),`,
    `${Math.abs(score).toFixed(1)}× the campaign's usual day-to-day spread.`,
    ...(spend ? [`Spend held at ${usd(spend.observed)} against ${usd(spend.baseline)} (${signedPct(spend.pctChange)}).`] : []),
  ].join(" ");

  const investigateDays = Math.max(1, Math.min(ANOMALY_INVESTIGATE_DAYS, Math.floor((daysBetween(input.firstDataDate, date) + 1) / 2)));

  return {
    id: `${campaign.id}:${type}:${date}`,
    type,
    typeLabel: rule.label,
    severity,
    campaign,
    date,
    dayType,
    metric,
    metricLabel: def.label,
    definition: def.definition,
    unit: def.unit,
    observed: round(observed),
    baseline: round(center),
    spread: round(spread),
    history: base.map((b) => ({ date: b.date, value: round(b.value) })).reverse(),
    absChange: round(absChange),
    pctChange: round(pctChange),
    score: Math.round(score * 10) / 10,
    baselineWindow: window,
    rule: ruleText(rule, settings, dayWord, base.length),
    explanation,
    ...(caveats.length > 0 && { caveat: `${caveats.join(" ")} Capped at low.` }),
    caps,
    volume: `${volume.field === "spend" ? usd(day.spend) : count(day[volume.field])} ${volume.field === "spend" ? "spend" : volume.field}`,
    ...(spend && { spend }),
    investigate: { campaignId: campaign.id, from: addDays(date, -(investigateDays - 1)), to: date },
  };
}

/** The rule that fired, with its numbers: what a reviewer needs to reproduce the flag. */
export function ruleText(rule: AnomalyRule, settings: AnomalySettings, dayWord: string, days: number): string {
  const dir = rule.direction === "up" ? "+" : "−";
  const { medium, high } = settings.severity;
  const at = (m: number) => `${dir}${Math.round(rule.minChange * m * 100)}%`;
  return [
    `${ANOMALY_METRICS[rule.metric].label} ${dir}${Math.round(rule.minChange * 100)}% or more against the median of ${days} ${dayWord} in the last ${settings.lookbackDays}, and ${settings.minScore}+ robust z`,
    `(needs ${rule.volume.min}+ ${rule.volume.label}${rule.maxSpendDrop !== undefined ? `, and spend no more than ${Math.round(rule.maxSpendDrop * 100)}% below its own median` : ""}).`,
    `Medium at ${at(medium.changeMultiple)} and z ${medium.score}+, high at ${at(high.changeMultiple)} and z ${high.score}+.`,
  ].join(" ");
}
