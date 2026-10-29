import type { DateRange } from "./dates.type";

export type BriefItem = {
  id: string;
  kind: "cost_per_trial" | "cac" | "pacing" | "release";
  tone: "bad" | "good" | "info";
  title: string;
  detail: string;
  investigate?: { campaignId: string; from: string; to: string };
};

export type Brief = {
  date: string;
  week: DateRange;
  weekBefore: DateRange;
  cacFinalThrough: string;
  yesterday: { spend: number; trials: number; subscriptions: number; cost_per_trial: number | null; cac: number | null; cacFinal: boolean };
  baseline: { avgDailySpend: number; cost_per_trial: number | null; cac: number | null; cacFinal: boolean };
  previousWeekCac: number | null;
  headline: string;
  items: BriefItem[];
  more: number;
};
