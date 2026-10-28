import { RANGE_PRESETS } from "../constants/dates.constant.js";
import {
  BASE_METRICS,
  DERIVED_METRICS,
  DIMENSIONS,
  MAX_LIMIT,
  METRIC_KEYS,
  METRICS,
  MONEY_METRICS,
  TIME_DIMENSIONS,
} from "../constants/metrics.constant.js";
import type { MetricsRepository } from "../database/repositories/metrics.repository.js";
import { addDays, daysBetween, isValidDate, previousPeriod, resolvePreset } from "../lib/dates.js";
import { roundCents } from "../lib/money.js";
import { AppError } from "../lib/response.js";
import type { DateRange } from "../types/dates.type.js";
import type {
  BaseTotals,
  Catalog,
  DerivedMetric,
  Dimension,
  DimensionFields,
  MetricKey,
  MetricRow,
  MetricsQuery,
  MetricsRequest,
  MetricsResponse,
  MetricsResult,
} from "../types/metrics.type.js";

/**
 * Read-only access to the ad metrics. "Today" is the day after the last day in
 * the warehouse (2026-10-15 for the case data), so every relative period and
 * maturity check follows the data, not the wall clock.
 */
export class MetricsService {
  readonly lastDataDate: string;
  readonly firstDataDate: string;
  readonly today: string;

  private constructor(
    private readonly repo: MetricsRepository,
    bounds: DateRange,
  ) {
    this.firstDataDate = bounds.from;
    this.lastDataDate = bounds.to;
    this.today = addDays(bounds.to, 1);
  }

  /** Reads the data's date range once, at boot; every relative date follows from it. */
  static async create(repo: MetricsRepository): Promise<MetricsService> {
    const bounds = await repo.dataBounds();
    if (!bounds) {
      throw new Error("ads_daily is empty; cannot determine the data's date range");
    }
    return new MetricsService(repo, bounds);
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

  /** The glossary's metrics with their maturity, the data's span and the named periods. */
  catalog(): Catalog {
    return {
      today: this.today,
      firstDataDate: this.firstDataDate,
      lastDataDate: this.lastDataDate,
      metrics: METRIC_KEYS.map((key) => {
        const { formula, ...def } = METRICS[key];
        return {
          ...def,
          ...(formula && { formula: `${formula.numerator} ÷ ${formula.denominator}` }),
          lastFinalDate: this.lastFinalDate(key),
        };
      }),
      dimensions: [...DIMENSIONS],
      presets: RANGE_PRESETS.map((key) => ({ key, range: resolvePreset(key, this.today) })),
    };
  }

  /** Resolves a client request's period, runs it, and adds the previous period when asked. */
  async run(request: MetricsRequest): Promise<MetricsResponse> {
    const { preset, range: explicit, compare, ...rest } = request;
    const range = preset ? resolvePreset(preset, this.today) : explicit;
    if (!range) throw new AppError(400, "MISSING_RANGE", "Give either `preset` or `range`");

    const prevRange = compare ? previousPeriod(range) : undefined;
    const [result, previous] = await Promise.all([
      this.query({ ...rest, range }),
      prevRange && this.query({ ...rest, range: prevRange }),
    ]);
    return prevRange && previous ? { ...result, previous: { range: prevRange, totals: previous.totals } } : result;
  }

  async query(q: MetricsQuery): Promise<MetricsResult> {
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
    const grouped = await this.repo.aggregate(range, groupBy, filters);

    const totals = this.toRow({}, sumAll(grouped.map((g) => g.sums)), maxDate(grouped.map((g) => g.lastDate)));
    const rows = grouped.map((g) => this.toRow(g.dims, g.sums, g.lastDate));
    sortRows(rows, groupBy, q.orderBy);

    return { range, groupBy, rows: limit ? rows.slice(0, limit) : rows, totals };
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

/** Computes every derived metric from summed base values; `null` when the denominator is 0. */
export function deriveMetrics(totals: BaseTotals): Record<DerivedMetric, number | null> {
  return Object.fromEntries(
    DERIVED_METRICS.map((key) => {
      const { numerator, denominator } = METRICS[key].formula!;
      const den = totals[denominator];
      return [key, den === 0 ? null : totals[numerator] / den];
    }),
  ) as Record<DerivedMetric, number | null>;
}

function sumAll(list: BaseTotals[]): BaseTotals {
  const sums = Object.fromEntries(BASE_METRICS.map((m) => [m, 0])) as BaseTotals;
  for (const item of list) for (const m of BASE_METRICS) sums[m] += item[m];
  return sums;
}

const maxDate = (dates: string[]) => dates.reduce<string | null>((max, d) => (max && max > d ? max : d), null);

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
