import type { AgentModelId, ModelUsage } from "./agent.type.js";
import type { DateRange } from "./dates.type.js";
import type { Campaign } from "./entities.type.js";
import type { MetricKey, Unit } from "./metrics.type.js";
import type { Commit, Platform } from "./releases.type.js";

/** The glossary's metrics plus CPC (spend ÷ clicks), which the brief asks for but the glossary doesn't define. */
export type InvestigationMetricKey = MetricKey | "cpc";

export type StageKey = "validate" | "current" | "previous" | "breakdown" | "releases" | "interpret";

/** Absolute and relative change between two values; null where it can't be computed. */
export type Change = {
  absChange: number | null;
  /** Relative to the previous value (0.1 = +10%); null when the previous value is 0 or either is missing. */
  pctChange: number | null;
};

export type MetricComparison = Change & {
  key: InvestigationMetricKey;
  /** Evidence id the model cites: `metric:<key>`. */
  evidenceId: string;
  label: string;
  unit: Unit;
  better: "higher" | "lower" | "neutral";
  /** `numerator ÷ denominator`, for derived metrics. */
  formula?: string;
  inGlossary: boolean;
  previous: number | null;
  current: number | null;
  /** Whether the change is good, judged by `better`; null when flat, neutral or unknown. */
  assessment: "better" | "worse" | null;
  /** The period includes install days too recent for this metric to be final. */
  provisional: { previous: boolean; current: boolean };
};

/** One factor of CAC = spend/impressions × impressions/clicks × clicks/installs × installs/subscriptions. */
export type CacDriver = Change & {
  key: "cpm" | "ctr" | "click_to_install" | "install_to_sub";
  evidenceId: string;
  label: string;
  unit: "usd" | "ratio";
  previous: number;
  current: number;
  /** What this factor alone did to CAC, others held fixed (0.1 = CAC +10%). */
  effectOnCac: number;
  /** Its part of the CAC change on a log scale; the four add up to 1. Null when CAC barely moved. */
  share: number | null;
  provisional: boolean;
};

export type CacDrivers =
  | { available: true; cacChange: number; items: CacDriver[] }
  | { available: false; reason: string };

export type PeriodValues = {
  spend: number;
  installs: number;
  trials: number;
  subscriptions: number;
  cac: number | null;
  cost_per_trial: number | null;
};

export type BreakdownRow = {
  /** `adset:<id>` or `ad:<id>`. */
  evidenceId: string;
  id: string;
  name: string;
  /** For ads: their ad set, since ad names repeat across ad sets. */
  adsetName?: string;
  status?: string;
  previous: PeriodValues;
  current: PeriodValues;
  spendChange: number;
  subscriptionChange: number;
  /** This row's part of the campaign's spend / subscription change; null when the campaign's didn't move. */
  spendShareOfChange: number | null;
  subscriptionShareOfChange: number | null;
  smallSample: boolean;
};

export type Breakdown = { rows: BreakdownRow[]; total: number };

export type DailyRow = PeriodValues & { date: string; period: "previous" | "current"; provisional: boolean };

export type ReleaseEvidence = {
  /** `release:<platform>-<version>`. */
  evidenceId: string;
  platform: Platform;
  version: string;
  released: string;
  date: string;
  period: "previous" | "current";
  /** Days from the selected period's first day (negative: before it). */
  dayOffset: number;
  commits: Commit[];
};

export type InvestigationFacts = {
  campaign: Campaign;
  current: { range: DateRange; days: number };
  previous: { range: DateRange; days: number };
  /** `insufficient` when the campaign has no spend in either period: there is nothing to explain. */
  status: "ok" | "insufficient";
  metrics: MetricComparison[];
  /** CAC, or cost per trial when CAC isn't final in the selected period (team note 5). */
  headlineMetric: "cac" | "cost_per_trial";
  /** One sentence built from the numbers, shown when there is no model interpretation. */
  overview: string;
  drivers: CacDrivers;
  adsets: Breakdown;
  ads: Breakdown;
  daily: DailyRow[];
  releases: ReleaseEvidence[];
  /** Fixed caveats from the data itself (maturity, sample size, missing days, no platform split). */
  limitations: string[];
  smallSample: boolean;
};

export type Finding = {
  title: string;
  explanation: string;
  /** Evidence ids from the facts; findings without any are dropped. */
  evidence: string[];
  kind: "verified" | "hypothesis";
  confidence: "high" | "medium" | "low";
};

export type Interpretation = {
  summary: string;
  findings: Finding[];
  releaseNotes: { release: string; relevance: string }[];
  nextSteps: string[];
  limitations: string[];
  /** Statements removed because they cited unknown evidence or figures not in the data. */
  removed: number;
};

export type InvestigationRequest = { campaignId: string; from: string; to: string; model?: AgentModelId };

export type InvestigationEvent =
  | { type: "stage"; key: StageKey; label: string; status: "running" | "done" | "skipped" }
  | { type: "facts"; facts: InvestigationFacts }
  | { type: "interpretation"; interpretation: Interpretation }
  | { type: "error"; code: string; message: string; retryAfterSeconds?: number }
  | { type: "done"; model: AgentModelId | null; usage: ModelUsage };
