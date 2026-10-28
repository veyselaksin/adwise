/** Dates are `YYYY-MM-DD` strings in UTC, the same format as `ads_daily.date`. */
export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export const DAY_MS = 86_400_000;

/** The team's named periods (team-notes.md); resolved in `lib/dates.ts`. */
export const RANGE_PRESETS = [
  "yesterday",
  "last_7_days",
  "last_14_days",
  "last_28_days",
  "last_week",
  "this_week",
  "this_month",
  "last_month",
] as const;
