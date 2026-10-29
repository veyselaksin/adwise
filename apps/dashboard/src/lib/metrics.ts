// Client-safe helpers over API rows. Formulas mirror the server's glossary
// definitions; use them only to combine rows the API already returned.

import { BASE_METRICS } from "@constants/metrics";
import type { BaseMetric, MetricDefinition, MetricDefs, MetricKey, MetricRow } from "@typings/metrics";

/** Sums base metrics over rows and re-derives the ratios (never averages ratios). */
export function combineRows(rows: MetricRow[]): MetricRow {
  const sums = Object.fromEntries(BASE_METRICS.map((m) => [m, 0])) as Record<BaseMetric, number>;
  const provisional = new Set<MetricKey>();
  for (const row of rows) {
    for (const m of BASE_METRICS) sums[m] += row[m];
    for (const p of row.provisional) provisional.add(p);
  }
  const ratio = (n: number, d: number) => (d === 0 ? null : n / d);
  return {
    ...sums,
    cpi: ratio(sums.spend, sums.installs),
    cac: ratio(sums.spend, sums.subscriptions),
    cost_per_trial: ratio(sums.spend, sums.trials),
    trial_to_sub: ratio(sums.trial_conversions, sums.trials),
    d7_roas: ratio(sums.d7_revenue, sums.spend),
    ctr: ratio(sums.clicks, sums.impressions),
    provisional: [...provisional],
  };
}

export const indexDefs = (metrics: MetricDefinition[]) =>
  Object.fromEntries(metrics.map((m) => [m.key, m])) as MetricDefs;

/**
 * Change from `previous` to `current`. Ratios (trial → sub, ROAS) change in
 * percentage points; everything else in percent.
 */
export function change(def: MetricDefinition, current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  const value = def.unit === "ratio" ? (current - previous) * 100 : previous === 0 ? null : (current - previous) / previous;
  if (value === null) return null;
  const direction = Math.abs(value) < (def.unit === "ratio" ? 0.05 : 0.0005) ? 0 : Math.sign(value);
  const sentiment =
    def.better === "neutral" || direction === 0
      ? "neutral"
      : (direction > 0) === (def.better === "higher")
        ? "good"
        : "bad";
  const text =
    def.unit === "ratio"
      ? `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`
      : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  return { direction, sentiment, text } as const;
}
