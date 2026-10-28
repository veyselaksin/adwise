import type { BASE_METRICS, DERIVED_METRICS, DIMENSIONS } from "../constants/metrics.constant.js";
import type { DateRange, RangePreset } from "./dates.type.js";

export type BaseMetric = (typeof BASE_METRICS)[number];
export type DerivedMetric = (typeof DERIVED_METRICS)[number];
export type MetricKey = BaseMetric | DerivedMetric;

export type Unit = "usd" | "count" | "ratio";

export type MetricInfo = {
  label: string;
  unit: Unit;
  /** Which direction is good, so the UI can color changes. */
  better: "higher" | "lower" | "neutral";
  /**
   * An install day's value keeps changing until it is this many days old,
   * because trials end and revenue arrives after the install. Younger days are
   * "provisional". 0 means final as soon as the day is loaded.
   */
  finalAfterDays: number;
};

export type MetricDefinition = MetricInfo & {
  key: MetricKey;
  /** For derived metrics: `numerator ÷ denominator`. */
  formula?: { numerator: BaseMetric; denominator: BaseMetric };
};

export type BaseTotals = Record<BaseMetric, number>;

export type Dimension = (typeof DIMENSIONS)[number];

/** Columns a row can carry, depending on what it is grouped by. */
export type DimensionFields = {
  date?: string;
  /** Monday of the week. */
  week?: string;
  /** `YYYY-MM`. */
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
};

export type MetricFilters = {
  channels?: string[];
  countries?: string[];
  campaignIds?: string[];
  adsetIds?: string[];
  adIds?: string[];
  creativeTypes?: string[];
  adStatus?: "active" | "paused";
};

export type MetricsQuery = {
  range: DateRange;
  groupBy?: Dimension[];
  filters?: MetricFilters;
  orderBy?: { metric: MetricKey; direction: "asc" | "desc" };
  limit?: number;
};

export type MetricRow = DimensionFields &
  BaseTotals &
  Record<DerivedMetric, number | null> & {
    /** Metrics that include install days too recent to be final. */
    provisional: MetricKey[];
  };

export type MetricsResult = {
  range: DateRange;
  groupBy: Dimension[];
  rows: MetricRow[];
  /** All rows combined (before `limit`): the blended number. */
  totals: MetricRow;
};

/** One group of summed base metrics, straight from the database. */
export type AggregateRow = { dims: DimensionFields; sums: BaseTotals; lastDate: string };

/** A query as clients send it: a named period or an explicit range, optionally compared. */
export type MetricsRequest = Omit<MetricsQuery, "range"> & {
  preset?: RangePreset;
  range?: DateRange;
  compare?: boolean;
};

export type MetricsResponse = MetricsResult & {
  /** Same-length period just before `range`, when `compare` is true. */
  previous?: { range: DateRange; totals: MetricRow };
};

export type CatalogMetric = Omit<MetricDefinition, "formula"> & { formula?: string; lastFinalDate: string };

export type Catalog = {
  today: string;
  firstDataDate: string;
  lastDataDate: string;
  metrics: CatalogMetric[];
  dimensions: Dimension[];
  presets: { key: RangePreset; range: DateRange }[];
};
