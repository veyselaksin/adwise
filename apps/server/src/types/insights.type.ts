import type { INSIGHT_SORTS } from "../constants/insights.constant.js";
import type { DateRange } from "./dates.type.js";
import type { MetricKey, Unit } from "./metrics.type.js";

/** One lookup the agent made while answering, with its output exactly as the model read it. */
export type Evidence = {
  /** The step id from the stream, e.g. "1.2". */
  id: string;
  tool: string;
  label: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  /** The tool's output; null when it was over SNAPSHOT_MAX_EVIDENCE_BYTES (then `truncated`). */
  data: Record<string, unknown> | null;
  truncated?: true;
};

/** What the agent stream signs once an answer is complete (see lib/snapshot.ts). */
export type Snapshot = {
  v: 1;
  /** When the answer finished, ISO time. */
  answeredAt: string;
  question: string;
  earlierQuestions: string[];
  answer: string;
  /** The model's remarks between lookups. */
  notes: string[];
  model: { id: string; label: string };
  /** The data's "today" when it was answered, so named periods can be read later. */
  dataToday: string;
  evidence: Evidence[];
};

export type MetricNote = {
  key: MetricKey;
  label: string;
  unit: Unit;
  /** e.g. "spend ÷ subscriptions"; base metrics have none. */
  formula?: string;
  /** Days an install day needs before this metric is final (team note). */
  finalAfterDays: number;
};

/** Read from the evidence when the insight is saved, never from the answer text. */
export type InsightScope = {
  /** Every period the lookups covered (resolved dates), merged into one span. */
  period: DateRange | null;
  ranges: DateRange[];
  channels: string[];
  countries: string[];
  campaigns: { id: string; name: string; channel: string; country: string }[];
  metrics: MetricNote[];
};

/** Caveats that come from the data itself (not the model's wording). */
export type DataCaveat = { kind: "not_final" | "rows_omitted" | "lookup_failed" | "evidence_truncated"; text: string };

export type Insight = {
  id: string;
  title: string;
  /** The answer's lead sentence, for the library list. */
  summary: string;
  /** The JWT subject that saved it; only they can rename or delete it. */
  owner: string;
  createdAt: string;
  updatedAt: string;
  snapshot: Snapshot;
  scope: InsightScope;
  caveats: DataCaveat[];
  /** sha256 of the token it was saved from, so the same answer isn't saved twice. */
  sourceHash: string;
};

/** A row of the library: everything but the snapshot. */
export type InsightSummary = Pick<Insight, "id" | "title" | "summary" | "owner" | "createdAt" | "updatedAt"> & {
  question: string;
  period: DateRange | null;
  campaigns: string[];
  model: string;
  evidenceCount: number;
  /** Whether the caller saved it. */
  mine: boolean;
};

export type InsightDraft = Pick<Insight, "title" | "summary" | "snapshot" | "scope" | "caveats">;

export type InsightSort = (typeof INSIGHT_SORTS)[number];

export type InsightQuery = {
  q?: string;
  sort?: InsightSort;
  /** Saved on or after this day (YYYY-MM-DD, UTC). */
  from?: string;
  /** Saved on or before this day. */
  to?: string;
};
