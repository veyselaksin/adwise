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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" → "Oct 5", as the dashboard writes days. */
export function shortDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** "Oct 5–11" within a month, "Sep 28 – Oct 4" across months, as the dashboard writes ranges. */
export function shortRange(range: { from: string; to: string }): string {
  if (range.from === range.to) return shortDay(range.from);
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) return `${shortDay(range.from)}–${Number(range.to.slice(8))}`;
  return `${shortDay(range.from)} – ${shortDay(range.to)}`;
}
