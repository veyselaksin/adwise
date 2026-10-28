/**
 * Period-over-period arithmetic for investigations. Pure functions: every
 * figure in a report comes from these over the metric layer's totals, never
 * from the model.
 */
import type { CacDriver, CacDrivers, Change } from "../types/investigation.type.js";

/** Below this, a relative CAC change counts as flat and driver shares aren't meaningful. */
const FLAT = 1e-9;

/**
 * Absolute and relative change from `previous` to `current`. Missing values give
 * nulls; a previous value of 0 gives no relative change (there's nothing to divide by).
 */
export function changeOf(previous: number | null | undefined, current: number | null | undefined): Change {
  if (previous === null || previous === undefined || current === null || current === undefined) {
    return { absChange: null, pctChange: null };
  }
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return { absChange: null, pctChange: null };
  const absChange = current - previous;
  return { absChange, pctChange: previous === 0 ? null : absChange / Math.abs(previous) };
}

/** `part ÷ whole` for a row's part of a total change; null when the total didn't move. */
export const shareOf = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

export type FunnelTotals = { spend: number; impressions: number; clicks: number; installs: number; subscriptions: number };

type DriverSpec = {
  key: CacDriver["key"];
  label: string;
  unit: CacDriver["unit"];
  value: (t: FunnelTotals) => number;
  /** +1 when the factor multiplies CAC, −1 when CAC is divided by it. */
  sign: 1 | -1;
};

/**
 * CAC = spend ÷ subscriptions
 *     = (spend ÷ impressions) ÷ (clicks ÷ impressions) ÷ (installs ÷ clicks) ÷ (subscriptions ÷ installs)
 * so the log of the CAC ratio is the sum of each factor's log ratio. CPM is shown per 1,000 impressions.
 */
const DRIVERS: DriverSpec[] = [
  { key: "cpm", label: "CPM (spend per 1,000 impressions)", unit: "usd", value: (t) => (t.spend / t.impressions) * 1000, sign: 1 },
  { key: "ctr", label: "CTR (clicks ÷ impressions)", unit: "ratio", value: (t) => t.clicks / t.impressions, sign: -1 },
  { key: "click_to_install", label: "Click → install (installs ÷ clicks)", unit: "ratio", value: (t) => t.installs / t.clicks, sign: -1 },
  {
    key: "install_to_sub",
    label: "Install → subscription (subscriptions ÷ installs)",
    unit: "ratio",
    value: (t) => t.subscriptions / t.installs,
    sign: -1,
  },
];

/**
 * Splits the CAC change into the funnel steps behind it. Each factor's effect is
 * what it alone did to CAC (others held fixed); shares are on a log scale, so they
 * add up to 1. Needs every funnel step to be non-zero in both periods.
 */
export function cacDrivers(prev: FunnelTotals, cur: FunnelTotals, opts: { subscriptionsProvisional: boolean }): CacDrivers {
  for (const t of [prev, cur]) {
    if (t.spend <= 0 || t.impressions <= 0 || t.clicks <= 0 || t.installs <= 0 || t.subscriptions <= 0) {
      return {
        available: false,
        reason: "CAC can't be split into funnel steps: spend, impressions, clicks, installs or subscriptions is zero in one of the periods.",
      };
    }
  }
  const cacLog = Math.log(cur.spend / cur.subscriptions / (prev.spend / prev.subscriptions));
  const items = DRIVERS.map((d): CacDriver => {
    const previous = d.value(prev);
    const current = d.value(cur);
    const logEffect = d.sign * Math.log(current / previous);
    return {
      key: d.key,
      evidenceId: `driver:${d.key}`,
      label: d.label,
      unit: d.unit,
      previous,
      current,
      ...changeOf(previous, current),
      effectOnCac: Math.exp(logEffect) - 1,
      share: Math.abs(cacLog) < FLAT ? null : logEffect / cacLog,
      provisional: d.key === "install_to_sub" && opts.subscriptionsProvisional,
    };
  });
  return { available: true, cacChange: Math.exp(cacLog) - 1, items };
}
