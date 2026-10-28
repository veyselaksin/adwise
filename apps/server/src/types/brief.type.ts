import type { DateRange } from "./dates.type.js";

export type BriefItem = {
  /** Stable key, e.g. `cpt:c_101`. */
  id: string;
  kind: "cost_per_trial" | "cac" | "pacing" | "release";
  /** `bad` needs a look, `good` is worth knowing, `info` is context. */
  tone: "bad" | "good" | "info";
  title: string;
  detail: string;
  /** Where to dig in: an investigation of this campaign over these days. */
  investigate?: { campaignId: string; from: string; to: string };
};

export type Brief = {
  /** The day the brief is about: yesterday, the last day in the data. */
  date: string;
  /** Last complete Monday–Sunday week, the baseline. */
  week: DateRange;
  weekBefore: DateRange;
  cacFinalThrough: string;
  yesterday: { spend: number; trials: number; subscriptions: number; cost_per_trial: number | null; cac: number | null; cacFinal: boolean };
  baseline: { avgDailySpend: number; cost_per_trial: number | null; cac: number | null; cacFinal: boolean };
  previousWeekCac: number | null;
  /** One or two sentences from the numbers alone. */
  headline: string;
  items: BriefItem[];
  /** Items beyond BRIEF_MAX_ITEMS. */
  more: number;
};
