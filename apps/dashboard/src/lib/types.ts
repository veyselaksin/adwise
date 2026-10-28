// Shapes returned by the API. Client-safe: no secrets, no server imports.

export const BASE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "installs",
  "trials",
  "trial_conversions",
  "subscriptions",
  "d7_revenue",
] as const;
export const DERIVED_METRICS = ["cpi", "cac", "cost_per_trial", "trial_to_sub", "d7_roas", "ctr"] as const;

export type BaseMetric = (typeof BASE_METRICS)[number];
export type DerivedMetric = (typeof DERIVED_METRICS)[number];
export type MetricKey = BaseMetric | DerivedMetric;

export type Dimension =
  | "date"
  | "week"
  | "month"
  | "channel"
  | "country"
  | "campaign"
  | "adset"
  | "ad"
  | "creative_type";

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

export type MetricRow = {
  date?: string;
  week?: string;
  month?: string;
  channel?: string;
  country?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  ad_status?: string;
  creative_type?: string;
  provisional: MetricKey[];
} & Record<BaseMetric, number> &
  Record<DerivedMetric, number | null>;

export type MetricsResult = {
  range: DateRange;
  groupBy: Dimension[];
  rows: MetricRow[];
  totals: MetricRow;
  previous?: { range: DateRange; totals: MetricRow };
};

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  unit: "usd" | "count" | "ratio";
  better: "higher" | "lower" | "neutral";
  formula?: string;
  finalAfterDays: number;
  lastFinalDate: string;
};

export type Catalog = {
  today: string;
  firstDataDate: string;
  lastDataDate: string;
  metrics: MetricDefinition[];
  dimensions: Dimension[];
  presets: { key: RangePreset; range: DateRange }[];
};

export type Entities = {
  campaigns: { id: string; name: string; channel: string; country: string; status: string }[];
  adsets: { id: string; campaign_id: string; name: string; status: string; daily_budget_usd: number }[];
  ads: { id: string; adset_id: string; name: string; creative_type: string; status: string; created_at: string }[];
};

export type MetricsQuery = {
  preset?: RangePreset;
  range?: DateRange;
  groupBy?: Dimension[];
  filters?: {
    channels?: string[];
    countries?: string[];
    campaignIds?: string[];
    adsetIds?: string[];
    adIds?: string[];
    creativeTypes?: string[];
    adStatus?: "active" | "paused";
  };
  orderBy?: { metric: MetricKey; direction: "asc" | "desc" };
  limit?: number;
  compare?: boolean;
};
