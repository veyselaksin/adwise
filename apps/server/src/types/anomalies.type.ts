import type { DateRange } from "./dates.type.js";
import type { BaseMetric, BaseTotals, Unit } from "./metrics.type.js";

export type AnomalyType =
  | "spend_spike"
  | "spend_drop"
  | "cac_increase"
  | "roas_decrease"
  | "ctr_decrease"
  | "cpc_increase"
  | "conversion_drop";

/** The glossary's metrics the monitor reads, plus CPC (spend ÷ clicks, as investigations compute it). */
export type AnomalyMetric = "spend" | "subscriptions" | "cac" | "d7_roas" | "ctr" | "cpc";

export type Severity = "high" | "medium" | "low";

export type DayType = "weekday" | "weekend";

/** Why a campaign × day × rule couldn't be checked. */
export type SkipReason = "short_history" | "not_final" | "low_volume" | "no_data" | "flat_baseline";

export type AnomalyRule = {
  label: string;
  metric: AnomalyMetric;
  /** The direction that gets flagged. */
  direction: "up" | "down";
  /** Smallest relative change that may be flagged (0.3 = 30%). */
  minChange: number;
  /** Least volume before the value means anything: on the checked day, or the baseline's median day. */
  volume: { field: BaseMetric; min: number; on: "day" | "baseline"; label: string };
  /**
   * Team note 6: below this volume no firm call, so the flag stays but is capped at low.
   * `on` as for `volume`.
   */
  smallSample?: { field: BaseMetric; below: number; on: "day" | "baseline" };
  /** conversion_drop only: how far spend may fall and still count as "held". */
  maxSpendDrop?: number;
};

export type AnomalySettings = {
  lookbackDays: number;
  splitWeekends: boolean;
  minBaselineDays: number;
  minScore: number;
  minRelativeSpread: number;
  severity: Record<"medium" | "high", { score: number; changeMultiple: number }>;
  settlingDays: number;
};

/** Why a flag is capped at low: the newest final day, or under the team's subscription bar. */
export type CapReason = "settling" | "small_sample";

export type CampaignRef = { id: string; name: string; channel: string; country: string };

/** One campaign's summed numbers per install day, as the metric layer returns them. */
export type CampaignSeries = { campaign: CampaignRef; days: Map<string, BaseTotals> };

export type DetectionInput = {
  series: CampaignSeries[];
  /** Days to check; the baseline reaches back before `from`. */
  range: DateRange;
  /** First day in the data: investigation links never reach before it. */
  firstDataDate: string;
  /** The latest final install day per metric (the team's maturity rule). */
  finalThrough: (metric: AnomalyMetric) => string;
  types?: AnomalyType[];
  settings?: AnomalySettings;
  rules?: Record<AnomalyType, AnomalyRule>;
};

export type Anomaly = {
  /** `campaign:type:date`; one record per campaign, rule and day. */
  id: string;
  type: AnomalyType;
  typeLabel: string;
  severity: Severity;
  campaign: CampaignRef;
  date: string;
  dayType: DayType;
  metric: AnomalyMetric;
  metricLabel: string;
  /** The formula, from the glossary (CPC: from the investigations). */
  definition: string;
  unit: Unit;
  observed: number;
  /** Median of the baseline days. */
  baseline: number;
  /** The usual day-to-day spread: 1.4826 × MAD, never under ANOMALY_SETTINGS.minRelativeSpread × |median|. */
  spread: number;
  /** The baseline days' values, oldest first (the flagged day is `observed`), for the dashboard's chart. */
  history: { date: string; value: number }[];
  absChange: number;
  /** null when the baseline is 0. */
  pctChange: number | null;
  /** Robust z-score, one decimal. */
  score: number;
  baselineWindow: DateRange & { days: number };
  /** The rule as a sentence, with its thresholds. */
  rule: string;
  /** What was measured, from the numbers alone. */
  explanation: string;
  /** e.g. the day is the newest one the team counts as final. */
  caveat?: string;
  /** Why the flag is capped at low; empty when it isn't. */
  caps: CapReason[];
  /** The volume the check stood on, e.g. "42 subscriptions". */
  volume: string;
  /** conversion_drop: spend on the day against its baseline. */
  spend?: { observed: number; baseline: number; pctChange: number | null };
  investigate: { campaignId: string; from: string; to: string };
};

export type DetectionResult = {
  anomalies: Anomaly[];
  checks: number;
  skipped: Record<SkipReason, number>;
};

export type AnomalyQuery = {
  from?: string;
  to?: string;
  channel?: string;
  country?: string;
  type?: AnomalyType;
  /** `hide` leaves out flags capped at low and counts them in `hiddenCapped` instead. Default `show`. */
  capped?: "show" | "hide";
};

export type AnomalyReport = {
  range: DateRange;
  filters: { channel: string | null; country: string | null; type: AnomalyType | null; capped: "show" | "hide" };
  /** Latest final install day for the metrics that mature. */
  finalThrough: Record<"cac" | "subscriptions" | "d7_roas", string>;
  summary: {
    total: number;
    bySeverity: Record<Severity, number>;
    byType: Partial<Record<AnomalyType, number>>;
    /** Campaigns with at least one flag, most severe first. */
    campaigns: { campaign: CampaignRef; count: number; topSeverity: Severity; types: AnomalyType[] }[];
    campaignsChecked: number;
  };
  coverage: { checks: number; skipped: Record<SkipReason, number> };
  /** With `capped=hide`: what was left out, grouped so the dashboard can say it in a line. null otherwise. */
  hiddenCapped: {
    total: number;
    /** Newest-final-day flags per day: how many campaigns, on which metrics. */
    settling: { date: string; campaigns: number; metrics: string[] }[];
    /** Flags under the team's subscription bar (and not settling). */
    smallSample: number;
  } | null;
  /** The thresholds behind every flag, so the dashboard can show how detection works. */
  method: {
    lookbackDays: number;
    splitWeekends: boolean;
    minBaselineDays: number;
    minScore: number;
    severity: AnomalySettings["severity"];
    rules: { type: AnomalyType; label: string; metric: AnomalyMetric; definition: string; direction: "up" | "down"; minChange: number; volume: string }[];
  };
  anomalies: Anomaly[];
};
