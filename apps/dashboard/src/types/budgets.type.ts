import type { DateRange } from "./dates.type";

export type PacingStatus = "on_pace" | "over" | "under" | "paused";

export type PacingFields = {
  daily_budget_usd: number;
  spend: number;
  avg_daily_spend: number;
  last_day_spend: number;
  /** avg_daily_spend ÷ daily_budget_usd; null without a budget. */
  pace: number | null;
  pacing: PacingStatus;
};

export type BudgetPacing = {
  range: DateRange;
  days: number;
  band: { under: number; over: number };
  adsets: ({ adset_id: string; adset_name: string; campaign_id: string; status: string } & PacingFields)[];
  campaigns: ({ campaign_id: string; campaign_name: string; channel: string; country: string } & PacingFields)[];
};
