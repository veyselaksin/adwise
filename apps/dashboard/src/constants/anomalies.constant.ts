import type { AnomalyType, Severity, SkipReason } from "@typings/anomalies";

export const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  spend_spike: "Spend spike",
  spend_drop: "Spend drop",
  cac_increase: "CAC increase",
  roas_decrease: "D7 ROAS decrease",
  ctr_decrease: "CTR decrease",
  cpc_increase: "CPC increase",
  conversion_drop: "Conversions down, spend held",
};

export const SEVERITY_LABELS: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

export const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

export const SKIP_LABELS: Record<SkipReason, string> = {
  short_history: "too little history before the day",
  not_final: "metric not final yet",
  low_volume: "too little volume",
  no_data: "no data that day",
  flat_baseline: "baseline of zero",
};

/** Ranges the monitor offers, in days ending yesterday. */
export const ANOMALY_RANGES = [7, 14, 28] as const;

export const ANOMALY_DEFAULT_DAYS = 14;
