import type { DateRange } from "./dates.type";

// Mirrors the server's anomaly report (GET /anomalies).

export type AnomalyType =
  | "spend_spike"
  | "spend_drop"
  | "cac_increase"
  | "roas_decrease"
  | "ctr_decrease"
  | "cpc_increase"
  | "conversion_drop";

export type Severity = "high" | "medium" | "low";

export type SkipReason = "short_history" | "not_final" | "low_volume" | "no_data" | "flat_baseline";

export type CampaignRef = { id: string; name: string; channel: string; country: string };

export type Anomaly = {
  id: string;
  type: AnomalyType;
  typeLabel: string;
  severity: Severity;
  campaign: CampaignRef;
  date: string;
  dayType: "weekday" | "weekend";
  metric: "spend" | "subscriptions" | "cac" | "d7_roas" | "ctr" | "cpc";
  metricLabel: string;
  definition: string;
  unit: "usd" | "count" | "ratio";
  observed: number;
  baseline: number;
  /** Usual day-to-day spread; the score is (observed − baseline) ÷ spread. */
  spread: number;
  /** The baseline days' values, oldest first. */
  history: { date: string; value: number }[];
  absChange: number;
  pctChange: number | null;
  score: number;
  baselineWindow: DateRange & { days: number };
  rule: string;
  explanation: string;
  caveat?: string;
  caps: ("settling" | "small_sample")[];
  volume: string;
  spend?: { observed: number; baseline: number; pctChange: number | null };
  investigate: { campaignId: string; from: string; to: string };
};

export type AnomalyQuery = {
  from?: string;
  to?: string;
  channel?: string;
  country?: string;
  type?: AnomalyType;
  capped?: "show" | "hide";
};

export type AnomalyReport = {
  range: DateRange;
  filters: { channel: string | null; country: string | null; type: AnomalyType | null; capped: "show" | "hide" };
  finalThrough: { cac: string; subscriptions: string; d7_roas: string };
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byType: Partial<Record<AnomalyType, number>>;
    campaigns: { campaign: CampaignRef; count: number; topSeverity: Severity; types: AnomalyType[] }[];
    campaignsChecked: number;
  };
  coverage: { checks: number; skipped: Record<SkipReason, number> };
  /** With capped=hide: the low, capped flags left out; null when they're shown. */
  hiddenCapped: {
    total: number;
    settling: { date: string; campaigns: number; metrics: string[] }[];
    smallSample: number;
  } | null;
  method: {
    lookbackDays: number;
    splitWeekends: boolean;
    minBaselineDays: number;
    minScore: number;
    severity: Record<"medium" | "high", { score: number; changeMultiple: number }>;
    rules: {
      type: AnomalyType;
      label: string;
      metric: Anomaly["metric"];
      definition: string;
      direction: "up" | "down";
      minChange: number;
      volume: string;
    }[];
  };
  anomalies: Anomaly[];
};
