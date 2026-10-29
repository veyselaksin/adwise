// Dashboard state lives in the URL, so a view can be bookmarked or shared.

import { DATE_PATTERN } from "@constants/dates";
import { CHANNELS, COUNTRIES, DEFAULT_FILTERS, PRESET_LABELS } from "@constants/filters";
import { CHART_METRICS } from "@constants/metrics";
import type { RangePreset } from "@typings/dates";
import type { DashboardFilters } from "@typings/filters";
import type { MetricKey } from "@typings/metrics";

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined): v is string => !!v && DATE_PATTERN.test(v);

/** Parses search params, falling back to defaults for anything unknown. */
export function parseFilters(params: Params): DashboardFilters {
  const preset = one(params.range);
  const from = one(params.from);
  const to = one(params.to);
  const channel = one(params.channel);
  const country = one(params.country);
  const metric = one(params.metric) as MetricKey | undefined;
  const split = one(params.split);

  const custom = preset === "custom" && isDate(from) && isDate(to) && from <= to;
  return {
    preset: custom ? "custom" : preset && preset in PRESET_LABELS ? (preset as RangePreset) : DEFAULT_FILTERS.preset,
    ...(custom && { range: { from, to } }),
    channel: CHANNELS.some((c) => c.value === channel) ? channel! : "all",
    country: COUNTRIES.some((c) => c.value === country) ? country! : "all",
    metric: metric && CHART_METRICS.includes(metric) ? metric : DEFAULT_FILTERS.metric,
    split: split === "country" || split === "none" ? split : DEFAULT_FILTERS.split,
  };
}

/** Serializes filters back to a query string, leaving defaults out. */
export function filtersToSearch(f: DashboardFilters): string {
  const p = new URLSearchParams();
  if (f.preset !== DEFAULT_FILTERS.preset) p.set("range", f.preset);
  if (f.preset === "custom" && f.range) {
    p.set("from", f.range.from);
    p.set("to", f.range.to);
  }
  if (f.channel !== "all") p.set("channel", f.channel);
  if (f.country !== "all") p.set("country", f.country);
  if (f.metric !== DEFAULT_FILTERS.metric) p.set("metric", f.metric);
  if (f.split !== DEFAULT_FILTERS.split) p.set("split", f.split);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The API's filter object for the chosen channel/country. */
export function apiFilters(f: DashboardFilters) {
  return {
    ...(f.channel !== "all" && { channels: [f.channel] }),
    ...(f.country !== "all" && { countries: [f.country] }),
  };
}
