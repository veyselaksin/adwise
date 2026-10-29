// The anomaly monitor's filters live in the URL, like the overview's, so a view can be shared.

import { ANOMALY_DEFAULT_DAYS, ANOMALY_RANGES, ANOMALY_TYPE_LABELS } from "@constants/anomalies";
import { DATE_PATTERN } from "@constants/dates";
import { CHANNELS, COUNTRIES } from "@constants/filters";
import type { AnomalyQuery, AnomalyType } from "@typings/anomalies";
import type { DateRange } from "@typings/dates";
import { addDays } from "./format";

export type AnomalyPeriod = `${(typeof ANOMALY_RANGES)[number]}` | "all" | "custom";

export type AnomalyFilters = {
  period: AnomalyPeriod;
  /** Only for `custom`. */
  range?: DateRange;
  channel: string | "all";
  country: string | "all";
  type: AnomalyType | "all";
  /** Show flags capped at low (newest final day, small samples). Hidden by default: they bury the real signals. */
  showCapped: boolean;
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined): v is string => !!v && DATE_PATTERN.test(v);
const PERIODS = new Set<string>([...ANOMALY_RANGES.map(String), "all", "custom"]);

/** Parses search params; anything unknown falls back to the default. */
export function parseAnomalyFilters(params: Params): AnomalyFilters {
  const period = one(params.range);
  const from = one(params.from);
  const to = one(params.to);
  const channel = one(params.channel);
  const country = one(params.country);
  const type = one(params.type);
  const custom = period === "custom" && isDate(from) && isDate(to) && from <= to;
  return {
    period: custom ? "custom" : period && PERIODS.has(period) && period !== "custom" ? (period as AnomalyPeriod) : `${ANOMALY_DEFAULT_DAYS}` as AnomalyPeriod,
    ...(custom && { range: { from, to } }),
    channel: CHANNELS.some((c) => c.value === channel) ? channel! : "all",
    country: COUNTRIES.some((c) => c.value === country) ? country! : "all",
    type: type && type in ANOMALY_TYPE_LABELS ? (type as AnomalyType) : "all",
    showCapped: one(params.capped) === "show",
  };
}

export function anomalyFiltersToSearch(f: AnomalyFilters): string {
  const p = new URLSearchParams();
  if (f.period !== `${ANOMALY_DEFAULT_DAYS}`) p.set("range", f.period);
  if (f.period === "custom" && f.range) {
    p.set("from", f.range.from);
    p.set("to", f.range.to);
  }
  if (f.channel !== "all") p.set("channel", f.channel);
  if (f.country !== "all") p.set("country", f.country);
  if (f.type !== "all") p.set("type", f.type);
  if (f.showCapped) p.set("capped", "show");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The days a period covers, ending on the last day in the data. */
export function anomalyRange(f: AnomalyFilters, bounds: { first: string; last: string }): DateRange {
  if (f.period === "custom" && f.range) return f.range;
  if (f.period === "all") return { from: bounds.first, to: bounds.last };
  const from = addDays(bounds.last, -(Number(f.period) - 1));
  return { from: from < bounds.first ? bounds.first : from, to: bounds.last };
}

export function anomalyQuery(f: AnomalyFilters, range: DateRange): AnomalyQuery {
  return {
    ...range,
    ...(f.channel !== "all" && { channel: f.channel }),
    ...(f.country !== "all" && { country: f.country }),
    ...(f.type !== "all" && { type: f.type }),
    capped: f.showCapped ? "show" : "hide",
  };
}
