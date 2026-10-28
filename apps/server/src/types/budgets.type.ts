import type { PACING_STATUSES } from "../constants/budgets.constant.js";
import type { DateRange } from "./dates.type.js";

export type PacingStatus = (typeof PACING_STATUSES)[number];

/** An ad set's budget and its spend over a window, straight from the database. */
export type AdSetSpend = {
  adset_id: string;
  adset_name: string;
  status: string;
  daily_budget_usd: number;
  campaign_id: string;
  campaign_name: string;
  channel: string;
  country: string;
  spend: number;
  last_day_spend: number;
};

export type PacingFields = {
  daily_budget_usd: number;
  /** Total spend over the window. */
  spend: number;
  avg_daily_spend: number;
  /** Spend on the window's last day (yesterday). */
  last_day_spend: number;
  /** `avg_daily_spend ÷ daily_budget_usd`; null without a budget. */
  pace: number | null;
  pacing: PacingStatus;
};

export type AdSetPacing = { adset_id: string; adset_name: string; campaign_id: string; status: string } & PacingFields;

export type CampaignPacing = {
  campaign_id: string;
  campaign_name: string;
  channel: string;
  country: string;
} & PacingFields;

export type BudgetPacing = {
  range: DateRange;
  days: number;
  band: { under: number; over: number };
  adsets: AdSetPacing[];
  /** Active ad sets summed per campaign. */
  campaigns: CampaignPacing[];
};
