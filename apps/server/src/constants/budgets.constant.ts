/**
 * Budget pacing. `ad_sets.daily_budget_usd` is only the current budget (the data
 * shows budgets were raised and cut over time), so pacing is judged over a short
 * recent window, never over an arbitrary date range.
 */
export const PACING_DEFAULT_DAYS = 7;
export const PACING_MAX_DAYS = 14;

/** Average daily spend ÷ budget outside this band is flagged. Daily spend normally swings about ±10%. */
export const PACING_BAND = { under: 0.9, over: 1.1 } as const;

export const PACING_STATUSES = ["on_pace", "over", "under", "paused"] as const;
