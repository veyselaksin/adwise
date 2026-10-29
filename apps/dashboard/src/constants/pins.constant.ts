import type { MetricKey } from "../types/metrics.type";

/** When a pinned call asked for every metric, a tile shows these. */
export const PIN_DEFAULT_METRICS: MetricKey[] = ["spend", "subscriptions", "cac", "cost_per_trial"];

export const PIN_MAX_COLUMNS = 4;
