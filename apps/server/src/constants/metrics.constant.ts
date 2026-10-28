/**
 * Metric definitions from the team's glossary. The dashboard and the agent both
 * read numbers through these, so a metric means the same thing everywhere.
 *
 * Derived metrics are always a ratio of sums over the whole group, never an
 * average of daily ratios.
 */
import type { BaseMetric, DerivedMetric, MetricDefinition, MetricInfo, MetricKey } from "../types/metrics.type.js";

/** Additive columns summed straight from `ads_daily`. */
export const BASE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "installs",
  "trials",
  "trial_conversions",
  "subscriptions",
  "d7_revenue",
] as const;

export const DERIVED_METRICS = ["cpi", "cac", "cost_per_trial", "trial_to_sub", "d7_roas", "ctr"] as const;

export const METRIC_KEYS = [...BASE_METRICS, ...DERIVED_METRICS] as MetricKey[];

/** Ways to split a query's rows. */
export const DIMENSIONS = [
  "date",
  "week",
  "month",
  "channel",
  "country",
  "campaign",
  "adset",
  "ad",
  "creative_type",
] as const;

export const TIME_DIMENSIONS = new Set<string>(["date", "week", "month"]);

/** Most rows one query returns. */
export const MAX_LIMIT = 500;

/**
 * Maturity windows:
 * - subscriptions: 4 days, from the team note "CAC for days less than 4 days old isn't final".
 * - trial conversions: 5 days. A 3-day trial that starts after the install day
 *   ends later, and the data shows 4-day-old cohorts still filling in (example 3
 *   cuts October at Oct 10 for the same reason).
 * - D7 revenue: 7 days, by definition (revenue from the user's first 7 days).
 */
const BASE_INFO: Record<BaseMetric, MetricInfo> = {
  spend: { label: "Spend", unit: "usd", better: "neutral", finalAfterDays: 0 },
  impressions: { label: "Impressions", unit: "count", better: "higher", finalAfterDays: 0 },
  clicks: { label: "Clicks", unit: "count", better: "higher", finalAfterDays: 0 },
  installs: { label: "Installs", unit: "count", better: "higher", finalAfterDays: 0 },
  trials: { label: "Trials", unit: "count", better: "higher", finalAfterDays: 0 },
  trial_conversions: { label: "Trial conversions", unit: "count", better: "higher", finalAfterDays: 5 },
  subscriptions: { label: "Subscriptions", unit: "count", better: "higher", finalAfterDays: 4 },
  d7_revenue: { label: "D7 revenue", unit: "usd", better: "higher", finalAfterDays: 7 },
};

type DerivedInfo = Omit<MetricInfo, "finalAfterDays"> & { numerator: BaseMetric; denominator: BaseMetric };

const DERIVED_INFO: Record<DerivedMetric, DerivedInfo> = {
  cpi: { label: "CPI", unit: "usd", better: "lower", numerator: "spend", denominator: "installs" },
  cac: { label: "CAC", unit: "usd", better: "lower", numerator: "spend", denominator: "subscriptions" },
  cost_per_trial: { label: "Cost per trial", unit: "usd", better: "lower", numerator: "spend", denominator: "trials" },
  trial_to_sub: {
    label: "Trial → sub",
    unit: "ratio",
    better: "higher",
    numerator: "trial_conversions",
    denominator: "trials",
  },
  d7_roas: { label: "D7 ROAS", unit: "ratio", better: "higher", numerator: "d7_revenue", denominator: "spend" },
  ctr: { label: "CTR", unit: "ratio", better: "higher", numerator: "clicks", denominator: "impressions" },
};

/** Every metric, with a derived metric final only once both of its inputs are. */
export const METRICS: Record<MetricKey, MetricDefinition> = {
  ...(Object.fromEntries(BASE_METRICS.map((key) => [key, { key, ...BASE_INFO[key] }])) as Record<
    BaseMetric,
    MetricDefinition
  >),
  ...(Object.fromEntries(
    DERIVED_METRICS.map((key) => {
      const { numerator, denominator, ...info } = DERIVED_INFO[key];
      const finalAfterDays = Math.max(BASE_INFO[numerator].finalAfterDays, BASE_INFO[denominator].finalAfterDays);
      return [key, { key, ...info, finalAfterDays, formula: { numerator, denominator } }];
    }),
  ) as Record<DerivedMetric, MetricDefinition>),
};

export const MONEY_METRICS = new Set<string>(BASE_METRICS.filter((m) => METRICS[m].unit === "usd"));
