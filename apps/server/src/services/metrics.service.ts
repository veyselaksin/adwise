import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { AppError } from "../lib/response.js";
import { addDays, type DateRange, daysBetween, isValidDate } from "./dates.js";
import {
  BASE_COLUMNS,
  BASE_METRICS,
  type BaseTotals,
  deriveMetrics,
  type DerivedMetric,
  METRIC_KEYS,
  type MetricKey,
  METRICS,
} from "./definitions.js";

export const DIMENSIONS = [
  "date",
  "week",
  "month",
  "channel",
  "country",
  "campaign",
  "adset",
  "ad",
  "creative_type",
] as const;
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

export type Entities = {
  campaigns: { id: string; name: string; channel: string; country: string; status: string }[];
  adsets: { id: string; campaign_id: string; name: string; status: string; daily_budget_usd: number }[];
  ads: { id: string; adset_id: string; name: string; creative_type: string; status: string; created_at: string }[];
};

type DimensionSql = {
  /** Output alias → SQL expression. */
  columns: Record<string, string>;
  groupBy: string;
  /** Coarser dimensions this one carries along (an ad row also names its ad set). */
  implies?: Dimension[];
};

const DIMENSION_SQL: Record<Dimension, DimensionSql> = {
  date: { columns: { date: "d.date" }, groupBy: "d.date" },
  // Monday of the week: next Sunday (or today if Sunday), then back 6 days.
  week: { columns: { week: "date(d.date, 'weekday 0', '-6 days')" }, groupBy: "week" },
  month: { columns: { month: "substr(d.date, 1, 7)" }, groupBy: "month" },
  channel: { columns: { channel: "c.channel" }, groupBy: "c.channel" },
  country: { columns: { country: "c.country" }, groupBy: "c.country" },
  campaign: {
    columns: { campaign_id: "c.campaign_id", campaign_name: "c.name" },
    groupBy: "c.campaign_id",
    implies: ["channel", "country"],
  },
  adset: {
    columns: { adset_id: "s.adset_id", adset_name: "s.name" },
    groupBy: "s.adset_id",
    implies: ["campaign"],
  },
  ad: {
    columns: { ad_id: "a.ad_id", ad_name: "a.name", ad_status: "a.status" },
    groupBy: "a.ad_id",
    implies: ["adset", "creative_type"],
  },
  creative_type: { columns: { creative_type: "a.creative_type" }, groupBy: "a.creative_type" },
};

const TIME_DIMENSIONS = new Set<string>(["date", "week", "month"]);
const MONEY_METRICS = new Set<string>(BASE_METRICS.filter((m) => METRICS[m].unit === "usd"));

const FILTER_COLUMNS: Record<Exclude<keyof MetricFilters, "adStatus">, string> = {
  channels: "c.channel",
  countries: "c.country",
  campaignIds: "c.campaign_id",
  adsetIds: "s.adset_id",
  adIds: "a.ad_id",
  creativeTypes: "a.creative_type",
};

export const MAX_LIMIT = 500;

/**
 * Read-only access to the ad metrics. "Today" is the day after the last day in
 * the warehouse (2026-10-15 for the case data), so every relative period and
 * maturity check follows the data, not the wall clock.
 */
export class Metrics {
  readonly lastDataDate: string;
  readonly firstDataDate: string;
  readonly today: string;

  constructor(private readonly db: DatabaseSync) {
    const bounds = db.prepare("SELECT MIN(date) AS first, MAX(date) AS last FROM ads_daily").get();
    if (typeof bounds?.first !== "string" || typeof bounds.last !== "string") {
      throw new Error("ads_daily is empty; cannot determine the data's date range");
    }
    this.firstDataDate = bounds.first;
    this.lastDataDate = bounds.last;
    this.today = addDays(bounds.last, 1);
  }

  /** Whether `metric` for install day `date` has stopped changing. */
  isFinal(metric: MetricKey, date: string): boolean {
    return daysBetween(date, this.today) >= METRICS[metric].finalAfterDays;
  }

  /** The latest install day whose `metric` is final. */
  lastFinalDate(metric: MetricKey): string {
    const date = addDays(this.today, -METRICS[metric].finalAfterDays);
    return date < this.lastDataDate ? date : this.lastDataDate;
  }

  query(q: MetricsQuery): MetricsResult {
    const { range, filters = {}, limit } = q;
    if (!isValidDate(range.from) || !isValidDate(range.to)) {
      throw new AppError(400, "INVALID_DATE", "Dates must be valid YYYY-MM-DD values");
    }
    if (range.from > range.to) {
      throw new AppError(400, "INVALID_RANGE", "`from` must be on or before `to`");
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) {
      throw new AppError(400, "INVALID_LIMIT", `limit must be an integer from 1 to ${MAX_LIMIT}`);
    }

    const groupBy = [...new Set(q.groupBy ?? [])];
    const columns = new Map<string, string>();
    const groupExprs: string[] = [];
    const addDimension = (dim: Dimension, grouped: boolean) => {
      const sql = DIMENSION_SQL[dim];
      for (const [alias, expr] of Object.entries(sql.columns)) columns.set(alias, expr);
      if (grouped) groupExprs.push(sql.groupBy);
      // Implied dimensions are functionally dependent, so they add columns without splitting rows.
      for (const implied of sql.implies ?? []) addDimension(implied, false);
    };
    for (const dim of groupBy) addDimension(dim, true);

    const where = ["d.date BETWEEN ? AND ?"];
    const params: SQLInputValue[] = [range.from, range.to];
    for (const [key, column] of Object.entries(FILTER_COLUMNS) as [keyof typeof FILTER_COLUMNS, string][]) {
      const values = filters[key];
      if (values && values.length > 0) {
        where.push(`${column} IN (${values.map(() => "?").join(", ")})`);
        params.push(...values);
      }
    }
    if (filters.adStatus) {
      where.push("a.status = ?");
      params.push(filters.adStatus);
    }

    const select = [
      ...[...columns].map(([alias, expr]) => `${expr} AS ${alias}`),
      "MAX(d.date) AS last_date",
      ...BASE_METRICS.map((m) => `COALESCE(SUM(d.${BASE_COLUMNS[m]}), 0) AS ${m}`),
    ];
    const sql = [
      `SELECT ${select.join(", ")}`,
      "FROM ads_daily d",
      "JOIN ads a ON a.ad_id = d.ad_id",
      "JOIN ad_sets s ON s.adset_id = a.adset_id",
      "JOIN campaigns c ON c.campaign_id = s.campaign_id",
      `WHERE ${where.join(" AND ")}`,
      groupExprs.length > 0 ? `GROUP BY ${groupExprs.join(", ")}` : "",
    ].join("\n");

    const raw = this.db.prepare(sql).all(...params);
    // Without GROUP BY, SQLite returns one row even when nothing matched.
    const matched = raw.filter((r) => r.last_date !== null);

    const grouped = matched.map((r) => {
      const dims: DimensionFields = {};
      for (const alias of columns.keys()) {
        (dims as Record<string, unknown>)[alias] = r[alias];
      }
      const sums = Object.fromEntries(BASE_METRICS.map((m) => [m, Number(r[m])])) as BaseTotals;
      return { dims, sums, lastDate: String(r.last_date) };
    });

    const totals = this.toRow({}, sumAll(grouped.map((g) => g.sums)), maxDate(grouped.map((g) => g.lastDate)));
    const rows = grouped.map((g) => this.toRow(g.dims, g.sums, g.lastDate));
    sortRows(rows, groupBy, q.orderBy);

    return { range, groupBy, rows: limit ? rows.slice(0, limit) : rows, totals };
  }

  /** Campaigns, ad sets and ads with their settings, for filters and labels. */
  entities(): Entities {
    const all = <T>(sql: string) => this.db.prepare(sql).all() as T[];
    return {
      campaigns: all<Entities["campaigns"][number]>(
        "SELECT campaign_id AS id, name, channel, country, status FROM campaigns ORDER BY channel, country",
      ),
      adsets: all<Entities["adsets"][number]>(
        `SELECT adset_id AS id, campaign_id, name, status, daily_budget_usd
         FROM ad_sets ORDER BY campaign_id, name`,
      ),
      ads: all<Entities["ads"][number]>(
        "SELECT ad_id AS id, adset_id, name, creative_type, status, created_at FROM ads ORDER BY adset_id, name",
      ),
    };
  }

  /** `lastDate` is the row's latest install day; it decides which metrics are still provisional. */
  private toRow(dims: DimensionFields, sums: BaseTotals, lastDate: string | null): MetricRow {
    const totals = Object.fromEntries(
      BASE_METRICS.map((m) => [m, MONEY_METRICS.has(m) ? roundCents(sums[m]) : sums[m]]),
    ) as BaseTotals;
    const provisional = lastDate ? METRIC_KEYS.filter((m) => !this.isFinal(m, lastDate)) : [];
    return { ...dims, ...totals, ...deriveMetrics(totals), provisional };
  }
}

function sumAll(list: BaseTotals[]): BaseTotals {
  const sums = Object.fromEntries(BASE_METRICS.map((m) => [m, 0])) as BaseTotals;
  for (const item of list) for (const m of BASE_METRICS) sums[m] += item[m];
  return sums;
}

const maxDate = (dates: string[]) => dates.reduce<string | null>((max, d) => (max && max > d ? max : d), null);

const roundCents = (n: number) => Math.round(n * 100) / 100;

function sortRows(rows: MetricRow[], groupBy: Dimension[], orderBy: MetricsQuery["orderBy"]) {
  const timeKeys = groupBy.filter((d) => TIME_DIMENSIONS.has(d)) as ("date" | "week" | "month")[];
  rows.sort((a, b) => {
    for (const key of timeKeys) {
      const cmp = (a[key] ?? "").localeCompare(b[key] ?? "");
      if (cmp !== 0) return cmp;
    }
    if (orderBy) {
      const av = a[orderBy.metric];
      const bv = b[orderBy.metric];
      // Rows without a value (zero denominator) always go last.
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      const cmp = orderBy.direction === "asc" ? av - bv : bv - av;
      if (cmp !== 0) return cmp;
    }
    return b.spend - a.spend;
  });
}
