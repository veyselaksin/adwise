// Number and date formatting, fixed to en-US so server and browser render the
// same text. Team convention: USD with two decimals, percentages with one.

import type { MetricDefinition } from "@typings/metrics";

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCompactFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatUsd = (n: number | null) => (n === null ? "—" : usdFormat.format(n));
export const formatUsdCompact = (n: number) => usdCompactFormat.format(n);
export const formatCount = (n: number | null) => (n === null ? "—" : countFormat.format(n));
/** `ratio` is 0–1; 0.401 → "40.1%". */
export const formatPct = (ratio: number | null) => (ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`);

export function formatMetric(def: Pick<MetricDefinition, "unit">, value: number | null): string {
  if (def.unit === "usd") return formatUsd(value);
  if (def.unit === "ratio") return formatPct(value);
  return formatCount(value);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" → "Oct 5". */
export function formatDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** "Oct 5 – Oct 11", or "Oct 5–11" within a month, or a single day. */
export function formatRange(range: { from: string; to: string }): string {
  if (range.from === range.to) return formatDay(range.from);
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) {
    return `${formatDay(range.from)}–${Number(range.to.slice(8))}`;
  }
  return `${formatDay(range.from)} – ${formatDay(range.to)}`;
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
