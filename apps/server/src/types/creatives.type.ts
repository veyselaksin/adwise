import type { CREATIVE_STATUSES, IMAGE_ASPECT_RATIOS, IMAGE_MODEL_IDS } from "../constants/creatives.constant.js";
import type { AgentModelId, ModelUsage } from "./agent.type.js";
import type { DateRange } from "./dates.type.js";
import type { Change } from "./investigation.type.js";
import type { Unit } from "./metrics.type.js";

export type AspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number];
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

/** What the creative is about: a campaign, optionally narrowed to one of its ad sets or ads, over a period. */
export type CreativeSource = { campaignId: string; adsetId?: string; adId?: string; from: string; to: string };

/** Optional context the user types; none of it is checked against the data, so the model treats it as the user's claim. */
export type CreativeBrief = {
  productContext?: string;
  targetAudience?: string;
  desiredMessage?: string;
  brandVoice?: string;
  visualPreferences?: string;
  constraints?: string;
};

/**
 * One metric for the selected entity. `observed` values are summed straight from
 * the warehouse; `calculated` ones are ratios of those sums (the glossary's formulas,
 * plus CPC). null means it can't be computed (a zero denominator, no data), never 0.
 */
export type ContextMetric = Change & {
  key: string;
  /** What a concept cites: `metric:<key>`. */
  evidenceId: string;
  label: string;
  unit: Unit;
  kind: "observed" | "calculated";
  formula?: string;
  inGlossary: boolean;
  better: "higher" | "lower" | "neutral";
  current: number | null;
  /** null when there is no comparison period. */
  previous: number | null;
  assessment: "better" | "worse" | null;
  provisional: { current: boolean; previous: boolean };
};

export type ContextAd = {
  /** `ad:<id>`. */
  evidenceId: string;
  id: string;
  name: string;
  /** Ad names repeat across ad sets, so the ad set always goes with them. */
  adsetName: string;
  creativeType: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  installs: number;
  cpi: number | null;
  subscriptions: number;
  cac: number | null;
  cacProvisional: boolean;
  smallSample: boolean;
};

/** The measured performance a concept may build on, computed without the model. */
export type CreativeContext = {
  source: CreativeSource;
  level: "campaign" | "adset" | "ad";
  campaign: { id: string; name: string; channel: string; country: string; status: string };
  adset: { id: string; name: string; status: string } | null;
  ad: { id: string; name: string; creativeType: string; status: string } | null;
  range: DateRange;
  days: number;
  comparison: { available: true; range: DateRange } | { available: false; reason: string };
  /** `insufficient`: too little delivery to inform concepts; they're generated as exploratory then. */
  status: "ok" | "insufficient";
  statusReason: string | null;
  metrics: ContextMetric[];
  /** The campaign's or ad set's ads by spend, with their creative type (empty at ad level). */
  topAds: ContextAd[];
  /** Asked for in creative work, but not in this warehouse. */
  unavailable: { label: string; reason: string }[];
  notes: string[];
  smallSample: boolean;
};

export type ConceptEvidence = { evidenceId: string; label: string; observation: string };

export type CreativeConcept = {
  conceptId: string;
  title: string;
  creativeRationale: string;
  targetAudience: string;
  coreMessage: string;
  visualDescription: string;
  composition: string;
  suggestedHeadline: string;
  suggestedPrimaryText: string;
  suggestedCallToAction: string;
  imagePrompt: string;
  aspectRatio: AspectRatio;
  /** Observations from the context, each citing its evidence id; empty for exploratory concepts. */
  performanceEvidence: ConceptEvidence[];
  assumptions: string[];
  testHypothesis: string;
};

export type ConceptsRequest = {
  source?: CreativeSource;
  brief?: CreativeBrief;
  aspectRatio?: AspectRatio;
  model?: AgentModelId;
};

export type BriefField = keyof CreativeBrief;

/** Asks the text model to propose the brief fields the user left empty. */
export type BriefSuggestRequest = {
  source?: CreativeSource;
  /** What the user already wrote; those fields are never suggested over. */
  brief?: CreativeBrief;
  model?: AgentModelId;
};

/**
 * One proposed brief field. It's the AI's proposal, not data: `basis` says whether it
 * follows from the selection's data (names, channel, country, measured changes) or is an assumption.
 */
export type BriefSuggestion = { field: BriefField; value: string; basis: "data" | "assumption"; note: string };

export type BriefSuggestResult = {
  suggestions: BriefSuggestion[];
  dataInformed: boolean;
  context: CreativeContext | null;
  model: { id: AgentModelId; label: string };
  /** Suggestions or sentences the guardrails removed (figures, fields the user had filled). */
  removed: number;
  usage: ModelUsage;
  generatedAt: string;
};

export type ConceptsResult = {
  concepts: CreativeConcept[];
  /** true only when the concepts were written from measured performance (a source with enough delivery). */
  dataInformed: boolean;
  /** Why they're exploratory, when they are. */
  exploratoryReason: string | null;
  context: CreativeContext | null;
  model: { id: AgentModelId; label: string };
  /** Statements the guardrails removed (unknown evidence, figures not in the data). */
  removed: number;
  usage: ModelUsage;
  generatedAt: string;
};

export type CreativeCopy = { headline: string; primaryText: string; callToAction: string };

/** The measured numbers a creative was made from, frozen when it was generated. */
export type MetricsSnapshot = {
  range: DateRange;
  capturedAt: string;
  metrics: { key: string; label: string; unit: Unit; kind: "observed" | "calculated"; value: number | null; provisional: boolean }[];
};

export type CreativeCost =
  | { status: "reported"; usd: number; source: "provider" }
  | { status: "unavailable"; usd: null; reason: string };

export type Creative = {
  id: string;
  /** The JWT subject that generated it; only that account can see or change it. */
  owner: string;
  status: CreativeStatus;
  title: string;
  concept: CreativeConcept;
  copy: CreativeCopy;
  /** As the user approved it; the provider also gets IMAGE_PROMPT_SUFFIX. */
  imagePrompt: string;
  aspectRatio: AspectRatio;
  source: CreativeSource | null;
  sourceLabel: { campaign: string; adset: string | null; ad: string | null; channel: string; country: string } | null;
  dataInformed: boolean;
  metricsSnapshot: MetricsSnapshot | null;
  provider: string;
  model: ImageModelId;
  modelLabel: string;
  /** `file` is a server-chosen name inside CREATIVE_ASSETS_DIR; it never leaves the server. */
  image: { file: string; mimeType: string; bytes: number; width: number | null; height: number | null } | null;
  error: { code: string; message: string } | null;
  /** The creative this one is a new variation of. */
  parentId: string | null;
  /** The client's key for the request, so a resent click returns the same creative. Server-side only. */
  idempotencyKey: string;
  durationMs: number | null;
  attempts: number | null;
  cost: CreativeCost;
  /** The observability run that recorded the generation. */
  runId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/** A creative as the API returns it: no file name or idempotency key. */
export type CreativeView = Omit<Creative, "image" | "idempotencyKey"> & {
  image: { mimeType: string; bytes: number; width: number | null; height: number | null } | null;
};

export type CreativeSummary = Pick<
  CreativeView,
  "id" | "status" | "title" | "aspectRatio" | "dataInformed" | "sourceLabel" | "source" | "modelLabel" | "createdAt" | "image" | "error" | "parentId"
> & { headline: string };

export type CreativeListQuery = {
  q?: string;
  status?: CreativeStatus;
  basis?: "data" | "exploratory";
  campaignId?: string;
  page?: number;
  limit?: number;
};

export type CreativeList = { items: CreativeSummary[]; total: number; page: number; limit: number };

export type GenerateRequest = {
  idempotencyKey: string;
  /** Images to generate from this concept, 1–3 (default 1); each is its own creative and its own paid request. */
  count?: number;
  concept: Omit<CreativeConcept, "conceptId" | "performanceEvidence"> & {
    conceptId?: string;
    performanceEvidence: { evidenceId: string; label?: string; observation: string }[];
  };
  copy: CreativeCopy;
  imagePrompt: string;
  aspectRatio: AspectRatio;
  title?: string;
  source?: CreativeSource;
  parentId?: string;
};

export type CreativeChanges = { title?: string; copy?: Partial<CreativeCopy> };

export type StudioConfig = {
  image: {
    enabled: boolean;
    /** Why it's off, for the setup message. */
    disabledReason: string | null;
    provider: string;
    model: { id: ImageModelId; label: string };
    aspectRatios: AspectRatio[];
    defaultAspectRatio: AspectRatio;
    dailyLimit: number;
    usedToday: number;
    countMax: number;
    /** Kling via ZenMux reports no per-image cost, so the studio says so instead of guessing. */
    costNote: string;
  };
  concepts: { enabled: boolean; disabledReason: string | null };
  limits: { briefField: number; imagePrompt: number; maxDays: number };
  data: { firstDate: string; lastDate: string };
};

/** The creatives one image request made, in order; some may have failed when others succeeded. */
export type GenerateResult = { creatives: CreativeView[]; requested: number; replayed: boolean };
