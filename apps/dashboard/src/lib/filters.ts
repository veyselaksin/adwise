// Dashboard state lives in the URL, so a view can be bookmarked or shared.

import type { DateRange, MetricKey, RangePreset } from "./types";

export const PRESET_LABELS: Record<RangePreset, string> = {
  yesterday: "Yesterday",
  last_7_days: "Last 7 days",
  last_14_days: "Last 14 days",
  last_28_days: "Last 28 days",
  last_week: "Last week (Mon–Sun)",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
};

export const CHANNELS = [
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
] as const;

export const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "BR", label: "Brazil" },
] as const;

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

export type Split = "channel" | "country" | "none";

export type DashboardFilters = {
  preset: RangePreset | "custom";
  /** Only for `custom`. */
  range?: DateRange;
  channel: string | "all";
  country: string | "all";
  metric: MetricKey;
  split: Split;
};

export const DEFAULT_FILTERS: DashboardFilters = {
  preset: "last_14_days",
  channel: "all",
  country: "all",
  metric: "cac",
  split: "channel",
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

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
