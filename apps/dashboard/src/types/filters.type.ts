import type { DateRange, RangePreset } from "./dates.type";
import type { MetricKey } from "./metrics.type";

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
