import type { DateRange } from "@typings/dates";
import type { MetricKey, Unit } from "@typings/metrics";

/** One lookup the agent made, with its output exactly as the model read it. */
export type InsightEvidence = {
  id: string;
  tool: string;
  label: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  /** null when it was too large to keep (then `truncated`). */
  data: Record<string, unknown> | null;
  truncated?: true;
};

/** Frozen when the answer was given; a report never re-runs it. */
export type InsightSnapshot = {
  v: 1;
  answeredAt: string;
  question: string;
  earlierQuestions: string[];
  answer: string;
  notes: string[];
  model: { id: string; label: string };
  dataToday: string;
  evidence: InsightEvidence[];
};

export type InsightMetricNote = { key: MetricKey; label: string; unit: Unit; formula?: string; finalAfterDays: number };

/** Read from the evidence by the server, never from the answer's wording. */
export type InsightScope = {
  period: DateRange | null;
  ranges: DateRange[];
  channels: string[];
  countries: string[];
  campaigns: { id: string; name: string; channel: string; country: string }[];
  metrics: InsightMetricNote[];
};

export type InsightCaveat = { kind: "not_final" | "rows_omitted" | "lookup_failed" | "evidence_truncated"; text: string };

/** What saving an answer would store, from `POST /insights/preview`. */
export type InsightDraft = {
  title: string;
  summary: string;
  snapshot: InsightSnapshot;
  scope: InsightScope;
  caveats: InsightCaveat[];
};

export type Insight = InsightDraft & {
  id: string;
  owner: string;
  /** Whether the signed-in account saved it, and so may rename or delete it. */
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A library row: no snapshot. */
export type InsightSummary = {
  id: string;
  title: string;
  summary: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  question: string;
  period: DateRange | null;
  campaigns: string[];
  model: string;
  evidenceCount: number;
  /** Whether the signed-in account saved it. */
  mine: boolean;
};

export type InsightSort = "newest" | "oldest";

export type InsightQuery = { q?: string; sort?: InsightSort; from?: string; to?: string };

/** Server actions answer with data or a message to show; they never throw API errors at the browser. */
export type InsightActionResult<T = undefined> = { ok: true; data: T } | { ok: false; code: string; error: string };
