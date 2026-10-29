import type { RangePreset } from "@typings/dates";
import type { DashboardFilters } from "@typings/filters";

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

export const DEFAULT_FILTERS: DashboardFilters = {
  preset: "last_14_days",
  channel: "all",
  country: "all",
  metric: "cac",
  split: "channel",
};
