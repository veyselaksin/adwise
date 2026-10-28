import type { InvestigationMetricKey, StageKey } from "../types/investigation.type.js";

/** Longest period one investigation covers; the previous period must also fit in the data. */
export const INVESTIGATION_MAX_DAYS = 90;

/** Team note 6: no best/worst calls, and no firm conclusions on CAC, below this many subscriptions. */
export const MIN_SUBSCRIPTIONS = 20;

/** Ad sets and ads shown as the biggest movers; the rest are counted, not listed. */
export const TOP_MOVERS = 8;

/** Investigations per user per minute. Each one costs a model call or two. */
export const INVESTIGATION_RATE_LIMIT = 10;

/** One retry when the model's JSON is malformed, then the report goes out without an interpretation. */
export const INTERPRETATION_ATTEMPTS = 2;

/** Caps on what the model may hand back; longer items are cut, extra ones dropped. */
export const INTERPRETATION_LIMITS = { findings: 6, nextSteps: 5, limitations: 5, chars: 600, summaryChars: 900 };

/** Metrics compared, in the order the report shows them. CPC is the only one outside the glossary. */
export const INVESTIGATION_METRICS: InvestigationMetricKey[] = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "installs",
  "cpi",
  "trials",
  "cost_per_trial",
  "trial_conversions",
  "trial_to_sub",
  "subscriptions",
  "cac",
  "d7_revenue",
  "d7_roas",
];

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "validate", label: "Checking campaign and dates" },
  { key: "current", label: "Loading the selected period" },
  { key: "previous", label: "Loading the previous period" },
  { key: "breakdown", label: "Comparing ad sets, ads and days" },
  { key: "releases", label: "Matching app releases" },
  { key: "interpret", label: "Interpreting the evidence" },
];
