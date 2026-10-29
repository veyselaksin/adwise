export type RangePreset =
  | "yesterday"
  | "last_7_days"
  | "last_14_days"
  | "last_28_days"
  | "last_week"
  | "this_week"
  | "this_month"
  | "last_month";

export type DateRange = { from: string; to: string };
