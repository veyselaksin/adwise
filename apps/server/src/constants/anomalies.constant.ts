/**
 * The anomaly monitor's rules. Every check compares one campaign's day with the
 * same campaign's own recent days, so campaigns of different sizes are never
 * judged against each other. All the numbers that decide a flag live here.
 */
import { MIN_SUBSCRIPTIONS } from "./investigation.constant.js";
import type { AnomalyRule, AnomalySettings, AnomalyType } from "../types/anomalies.type.js";

export const ANOMALY_SETTINGS: AnomalySettings = {
  /** Days before the checked day that may form its baseline. Four weeks hold every weekday four times. */
  lookbackDays: 28,
  /**
   * Weekdays are compared with weekdays and Saturdays/Sundays with weekends. Across
   * the account, CPC runs about 5% lower and CAC about 4% lower at weekends, so a
   * mixed baseline would flag ordinary weekends.
   */
  splitWeekends: true,
  /** Fewer usable baseline days than this, and the check is skipped as short history. */
  minBaselineDays: 6,
  /**
   * Robust z-score: (value − baseline median) ÷ (1.4826 × MAD). Above this many
   * "usual spreads" from the median, a move counts as unusual. 3 is the textbook
   * cut-off for a robust outlier.
   */
  minScore: 3,
  /**
   * The spread never counts as smaller than this share of the median. A campaign
   * spending exactly its budget every day has a MAD of 0, and any cent would
   * otherwise be "infinitely" unusual.
   */
  minRelativeSpread: 0.05,
  /** Medium needs both a score and a change this many times the trigger; high, the larger ones. */
  severity: {
    medium: { score: 4.5, changeMultiple: 1.5 },
    high: { score: 6, changeMultiple: 2 },
  },
  /**
   * Days past the team's maturity line that still read as settling. The data's
   * newest "final" CAC day (4 days old) still reads ~40% high across the account,
   * so flags on it are kept but capped at low and say why.
   */
  settlingDays: 1,
};

/**
 * One rule per anomaly type. `minChange` is the smallest relative move worth a
 * flag, whatever the score; `volume` is the least data the day (or its baseline)
 * needs before a ratio means anything; under `smallSample` (team note 6's 20
 * subscriptions) a flag is still shown but capped at low.
 */
export const ANOMALY_RULES: Record<AnomalyType, AnomalyRule> = {
  spend_spike: {
    label: "Spend spike",
    metric: "spend",
    direction: "up",
    minChange: 0.3,
    volume: { field: "spend", min: 50, on: "baseline", label: "baseline daily spend" },
  },
  spend_drop: {
    label: "Spend drop",
    metric: "spend",
    direction: "down",
    minChange: 0.3,
    volume: { field: "spend", min: 50, on: "baseline", label: "baseline daily spend" },
  },
  cac_increase: {
    label: "CAC increase",
    metric: "cac",
    direction: "up",
    minChange: 0.3,
    volume: { field: "subscriptions", min: 5, on: "day", label: "subscriptions on the day" },
    smallSample: { field: "subscriptions", below: MIN_SUBSCRIPTIONS, on: "day" },
  },
  roas_decrease: {
    label: "D7 ROAS decrease",
    metric: "d7_roas",
    direction: "down",
    minChange: 0.25,
    volume: { field: "spend", min: 50, on: "day", label: "spend on the day" },
  },
  ctr_decrease: {
    label: "CTR decrease",
    metric: "ctr",
    direction: "down",
    minChange: 0.2,
    volume: { field: "impressions", min: 2000, on: "day", label: "impressions on the day" },
  },
  cpc_increase: {
    label: "CPC increase",
    metric: "cpc",
    direction: "up",
    minChange: 0.2,
    volume: { field: "clicks", min: 100, on: "day", label: "clicks on the day" },
  },
  conversion_drop: {
    label: "Conversions down, spend held",
    metric: "subscriptions",
    direction: "down",
    minChange: 0.3,
    volume: { field: "subscriptions", min: 5, on: "baseline", label: "baseline daily subscriptions" },
    smallSample: { field: "subscriptions", below: MIN_SUBSCRIPTIONS, on: "baseline" },
    /** Spend may fall at most this much against its own baseline, else fewer conversions is just less spend. */
    maxSpendDrop: 0.1,
  },
};

export const ANOMALY_TYPES = Object.keys(ANOMALY_RULES) as AnomalyType[];

/** Longest range one request checks: the whole data span. */
export const ANOMALY_MAX_DAYS = 60;

/** Default range when none is given: the last 14 full days. */
export const ANOMALY_DEFAULT_DAYS = 14;

/** Days the investigation link covers, ending on the flagged day (shortened near the start of the data). */
export const ANOMALY_INVESTIGATE_DAYS = 7;

/** Rows the agent's tool returns; the rest are counted. */
export const ANOMALY_TOOL_MAX_ROWS = 25;
