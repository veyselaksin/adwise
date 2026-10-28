/**
 * Calendar helpers. Dates are `YYYY-MM-DD` strings in UTC, the same format as
 * `ads_daily.date`, so they compare correctly as plain strings.
 */

export type DateRange = { from: string; to: string };

export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const DAY_MS = 86_400_000;

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromTime = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => fromTime(toTime(date) + days * DAY_MS);

/** Whole days from `a` to `b` (positive when `b` is later). */
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY_MS);

export function isValidDate(date: string): boolean {
  return new RegExp(DATE_PATTERN).test(date) && fromTime(toTime(date)) === date;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const weekday = new Date(toTime(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

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
export type RangePreset = (typeof RANGE_PRESETS)[number];

/**
 * Resolves the team's named periods (team-notes.md):
 * - "last N days" is the N full days ending yesterday
 * - "last week" is the previous Monday to Sunday
 * - "this week" / "this month" run up to yesterday
 */
export function resolvePreset(preset: RangePreset, today: string): DateRange {
  const yesterday = addDays(today, -1);
  const lastNDays = (n: number) => ({ from: addDays(today, -n), to: yesterday });
  switch (preset) {
    case "yesterday":
      return { from: yesterday, to: yesterday };
    case "last_7_days":
      return lastNDays(7);
    case "last_14_days":
      return lastNDays(14);
    case "last_28_days":
      return lastNDays(28);
    case "last_week": {
      const monday = addDays(startOfWeek(today), -7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "this_week":
      return { from: startOfWeek(yesterday), to: yesterday };
    case "this_month":
      return { from: `${yesterday.slice(0, 7)}-01`, to: yesterday };
    case "last_month": {
      const firstOfThisMonth = `${today.slice(0, 7)}-01`;
      const lastOfPrevious = addDays(firstOfThisMonth, -1);
      return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious };
    }
  }
}

/** The range of the same length that ends the day before `range` starts. */
export function previousPeriod(range: DateRange): DateRange {
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}
