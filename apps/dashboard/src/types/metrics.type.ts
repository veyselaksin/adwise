import type { BASE_METRICS, DERIVED_METRICS } from "@constants/metrics";
import type { DateRange, RangePreset } from "@typings/dates";

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

export type Unit = "usd" | "count" | "ratio";

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  unit: Unit;
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

export type MetricDefs = Record<MetricKey, MetricDefinition>;

export type KpiTile = {
  def: MetricDefinition;
  value: number | null;
  previous: number | null;
  /** The period the value covers, when it differs from the selected one. */
  range?: DateRange;
  /** Set when the value itself will still change. */
  notFinal?: string;
  /** Set when the value excludes recent days that aren't final. */
  note?: string;
};
