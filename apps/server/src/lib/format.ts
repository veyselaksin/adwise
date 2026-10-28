/**
 * Figures the way the team writes them (team-notes.md): USD with two decimals,
 * percentages with one. Fixed to en-US so the model and the dashboard see the same text.
 */
import type { Unit } from "../types/metrics.type.js";

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const usd = (n: number | null) => (n === null ? "—" : usdFormat.format(n));
export const count = (n: number | null) => (n === null ? "—" : countFormat.format(n));
/** A 0–1 ratio as a percentage: 0.401 → "40.1%". */
export const pct = (ratio: number | null) => (ratio === null ? "—" : `${(ratio * 100).toFixed(1)}%`);
export const signedPct = (ratio: number | null) => (ratio === null ? "—" : `${ratio > 0 ? "+" : ""}${pct(ratio)}`);

export function formatValue(unit: Unit, value: number | null): string {
  return unit === "usd" ? usd(value) : unit === "ratio" ? pct(value) : count(value);
}

/** A change in a metric's own unit: "+$2.48", "−1.2 pp" for ratios, "+35" for counts. */
export function formatDelta(unit: Unit, delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const size = Math.abs(delta);
  if (unit === "usd") return `${sign}${usd(size)}`;
  if (unit === "ratio") return `${sign}${(size * 100).toFixed(1)} pp`;
  return `${sign}${count(size)}`;
}
