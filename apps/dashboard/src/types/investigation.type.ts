import type { DateRange } from "@typings/dates";
import type { Entities } from "@typings/entities";
import type { MetricKey, Unit } from "@typings/metrics";

export type InvestigationMetricKey = MetricKey | "cpc";

export type InvestigationStageKey = "validate" | "current" | "previous" | "breakdown" | "releases" | "interpret";

export type MetricComparison = {
  key: InvestigationMetricKey;
  evidenceId: string;
  label: string;
  unit: Unit;
  better: "higher" | "lower" | "neutral";
  formula?: string;
  inGlossary: boolean;
  previous: number | null;
  current: number | null;
  absChange: number | null;
  /** 0.1 = +10%; null when the previous value is 0 or missing. */
  pctChange: number | null;
  assessment: "better" | "worse" | null;
  provisional: { previous: boolean; current: boolean };
};

export type CacDriver = {
  key: "cpm" | "ctr" | "click_to_install" | "install_to_sub";
  evidenceId: string;
  label: string;
  unit: "usd" | "ratio";
  previous: number;
  current: number;
  absChange: number | null;
  pctChange: number | null;
  effectOnCac: number;
  share: number | null;
  provisional: boolean;
};

export type PeriodValues = {
  spend: number;
  installs: number;
  trials: number;
  subscriptions: number;
  cac: number | null;
  cost_per_trial: number | null;
};

export type BreakdownRow = {
  evidenceId: string;
  id: string;
  name: string;
  adsetName?: string;
  status?: string;
  previous: PeriodValues;
  current: PeriodValues;
  spendChange: number;
  subscriptionChange: number;
  spendShareOfChange: number | null;
  subscriptionShareOfChange: number | null;
  smallSample: boolean;
};

export type ReleaseEvidence = {
  evidenceId: string;
  platform: "ios" | "android";
  version: string;
  released: string;
  date: string;
  period: "previous" | "current";
  dayOffset: number;
  commits: { hash: string; author: string; date: string; type: string | null; scope: string | null; title: string; body: string }[];
};

export type InvestigationFacts = {
  campaign: Entities["campaigns"][number];
  current: { range: DateRange; days: number };
  previous: { range: DateRange; days: number };
  status: "ok" | "insufficient";
  metrics: MetricComparison[];
  headlineMetric: "cac" | "cost_per_trial";
  overview: string;
  drivers: { available: true; cacChange: number; items: CacDriver[] } | { available: false; reason: string };
  adsets: { rows: BreakdownRow[]; total: number };
  ads: { rows: BreakdownRow[]; total: number };
  daily: (PeriodValues & { date: string; period: "previous" | "current"; provisional: boolean })[];
  releases: ReleaseEvidence[];
  limitations: string[];
  smallSample: boolean;
};

export type Finding = {
  title: string;
  explanation: string;
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
  removed: number;
};

/** What `POST /investigations` streams, one JSON object per line. */
export type InvestigationEvent =
  | { type: "stage"; key: InvestigationStageKey; label: string; status: "running" | "done" | "skipped" }
  | { type: "facts"; facts: InvestigationFacts }
  | { type: "interpretation"; interpretation: Interpretation }
  | { type: "error"; code: string; message: string; retryAfterSeconds?: number }
  | { type: "done"; model: string | null; usage: { inputTokens: number; outputTokens: number } };

export type InvestigationRequest = { campaignId: string; from: string; to: string; model?: string };

export type InvestigationStage = {
  key: InvestigationStageKey;
  label: string;
  status: "pending" | "running" | "done" | "skipped";
};

export type InvestigationState = {
  status: "idle" | "running" | "done" | "stopped";
  request?: InvestigationRequest;
  stages: InvestigationStage[];
  facts?: InvestigationFacts;
  interpretation?: Interpretation;
  error?: { code: string; message: string };
  model?: string | null;
};
