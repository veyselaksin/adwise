import type { MetricKey } from "../types/metrics.type";

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

/** The overview's KPI tiles. */
export const KPI_METRICS: MetricKey[] = [
  "spend",
  "installs",
  "trials",
  "subscriptions",
  "cac",
  "cost_per_trial",
  "trial_to_sub",
  "d7_roas",
];

/** Columns of the drill-down table and the matching export tables. */
export const DETAIL_METRICS: MetricKey[] = [
  "spend",
  "installs",
  "trials",
  "subscriptions",
  "cpi",
  "cost_per_trial",
  "cac",
  "trial_to_sub",
  "d7_roas",
  "ctr",
];

/** Metrics the trend chart can plot. */
export const CHART_METRICS: MetricKey[] = [
  "spend",
  "cac",
  "cost_per_trial",
  "trial_to_sub",
  "d7_roas",
  "installs",
  "subscriptions",
  "cpi",
  "ctr",
];

/** Team note 6: don't call a winner below 20 subscriptions. */
export const MIN_SUBSCRIPTIONS = 20;
