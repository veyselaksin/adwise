import type { DateRange, RangePreset } from "@typings/dates";
import type { MetricKey } from "@typings/metrics";

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
