import { BASE_METRICS } from "../../constants/metrics.constant.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { DateRange } from "../../types/dates.type.js";
import type {
  AggregateRow,
  BaseMetric,
  BaseTotals,
  Dimension,
  DimensionFields,
  MetricFilters,
} from "../../types/metrics.type.js";
import type { Database } from "../connection.js";

/** SQL column behind each base metric. */
const BASE_COLUMNS: Record<BaseMetric, string> = {
  spend: "spend_usd",
  impressions: "impressions",
  clicks: "clicks",
  installs: "installs",
  trials: "trials",
  trial_conversions: "trial_conversions",
  subscriptions: "subscriptions",
  d7_revenue: "d7_revenue_usd",
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

const FILTER_COLUMNS: Record<Exclude<keyof MetricFilters, "adStatus">, string> = {
  channels: "c.channel",
  countries: "c.country",
  campaignIds: "c.campaign_id",
  adsetIds: "s.adset_id",
  adIds: "a.ad_id",
  creativeTypes: "a.creative_type",
};

/**
 * Sums of `ads_daily`, joined to its campaign, ad set and ad. Grouping by
 * computed expressions (week, month) across joins is beyond Prisma's `groupBy`,
 * so this one query is SQL through `$queryRaw`: values are always bound
 * parameters, and only the fixed expressions above are spliced in.
 */
export class MetricsRepository {
  constructor(private readonly db: Database) {}

  /** First and last install day in the data, or null when `ads_daily` is empty. */
  async dataBounds(): Promise<DateRange | null> {
    const { _min, _max } = await this.db.adDaily.aggregate({ _min: { date: true }, _max: { date: true } });
    return _min.date && _max.date ? { from: _min.date, to: _max.date } : null;
  }

  /** Base metrics summed per group. Only groups with data in `range` are returned. */
  async aggregate(range: DateRange, groupBy: Dimension[], filters: MetricFilters): Promise<AggregateRow[]> {
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

    const where = [Prisma.sql`d.date BETWEEN ${range.from} AND ${range.to}`];
    for (const [key, column] of Object.entries(FILTER_COLUMNS) as [keyof typeof FILTER_COLUMNS, string][]) {
      const values = filters[key];
      if (values && values.length > 0) where.push(Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(values)})`);
    }
    if (filters.adStatus) where.push(Prisma.sql`a.status = ${filters.adStatus}`);

    const select = [
      ...[...columns].map(([alias, expr]) => `${expr} AS ${alias}`),
      "MAX(d.date) AS last_date",
      ...BASE_METRICS.map((m) => `COALESCE(SUM(d.${BASE_COLUMNS[m]}), 0) AS ${m}`),
    ];
    const query = Prisma.sql`
      SELECT ${Prisma.raw(select.join(", "))}
      FROM ads_daily d
      JOIN ads a ON a.ad_id = d.ad_id
      JOIN ad_sets s ON s.adset_id = a.adset_id
      JOIN campaigns c ON c.campaign_id = s.campaign_id
      WHERE ${Prisma.join(where, " AND ")}
      ${groupExprs.length > 0 ? Prisma.raw(`GROUP BY ${groupExprs.join(", ")}`) : Prisma.empty}`;

    const raw = await this.db.$queryRaw<Record<string, unknown>[]>(query);
    // Without GROUP BY, SQLite returns one row even when nothing matched.
    return raw
      .filter((r) => r.last_date !== null)
      .map((r) => {
        const dims: DimensionFields = {};
        for (const alias of columns.keys()) {
          (dims as Record<string, unknown>)[alias] = r[alias];
        }
        const sums = Object.fromEntries(BASE_METRICS.map((m) => [m, Number(r[m])])) as BaseTotals;
        return { dims, sums, lastDate: String(r.last_date) };
      });
  }
}
