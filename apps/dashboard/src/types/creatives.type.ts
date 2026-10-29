import type { DateRange } from "@typings/dates";
import type { Unit } from "@typings/metrics";

/** Mirrors the server's creative studio types (`apps/server/src/types/creatives.type.ts`). */

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3" | "21:9";
export type CreativeStatus = "generating" | "succeeded" | "failed";

export type CreativeSource = { campaignId: string; adsetId?: string; adId?: string; from: string; to: string };

export type CreativeBrief = {
  productContext?: string;
  targetAudience?: string;
  desiredMessage?: string;
  brandVoice?: string;
  visualPreferences?: string;
  constraints?: string;
};

export type ContextMetric = {
  key: string;
  evidenceId: string;
  label: string;
  unit: Unit;
  kind: "observed" | "calculated";
  formula?: string;
  inGlossary: boolean;
  better: "higher" | "lower" | "neutral";
  current: number | null;
  previous: number | null;
  absChange: number | null;
  pctChange: number | null;
  assessment: "better" | "worse" | null;
  provisional: { current: boolean; previous: boolean };
};

export type ContextAd = {
  evidenceId: string;
  id: string;
  name: string;
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

export type CreativeContext = {
  source: CreativeSource;
  level: "campaign" | "adset" | "ad";
  campaign: { id: string; name: string; channel: string; country: string; status: string };
  adset: { id: string; name: string; status: string } | null;
  ad: { id: string; name: string; creativeType: string; status: string } | null;
  range: DateRange;
  days: number;
  comparison: { available: true; range: DateRange } | { available: false; reason: string };
  status: "ok" | "insufficient";
  statusReason: string | null;
  metrics: ContextMetric[];
  topAds: ContextAd[];
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
  performanceEvidence: ConceptEvidence[];
  assumptions: string[];
  testHypothesis: string;
};

export type BriefField = keyof CreativeBrief;

export type BriefSuggestRequest = { source?: CreativeSource; brief?: CreativeBrief; model?: string };

/** The AI's proposal for one empty brief field; `basis` says whether it follows from the data or is an assumption. */
export type BriefSuggestion = { field: BriefField; value: string; basis: "data" | "assumption"; note: string };

export type BriefSuggestResult = {
  suggestions: BriefSuggestion[];
  dataInformed: boolean;
  model: { id: string; label: string };
  removed: number;
  generatedAt: string;
};

export type ConceptsRequest = { source?: CreativeSource; brief?: CreativeBrief; aspectRatio?: AspectRatio; model?: string };

export type ConceptsResult = {
  concepts: CreativeConcept[];
  dataInformed: boolean;
  exploratoryReason: string | null;
  context: CreativeContext | null;
  model: { id: string; label: string };
  removed: number;
  usage: { inputTokens: number; outputTokens: number };
  generatedAt: string;
};

export type CreativeCopy = { headline: string; primaryText: string; callToAction: string };

export type ImageInfo = { mimeType: string; bytes: number; width: number | null; height: number | null };

export type SourceLabel = { campaign: string; adset: string | null; ad: string | null; channel: string; country: string };

export type Creative = {
  id: string;
  owner: string;
  status: CreativeStatus;
  title: string;
  concept: CreativeConcept;
  copy: CreativeCopy;
  imagePrompt: string;
  aspectRatio: AspectRatio;
  source: CreativeSource | null;
  sourceLabel: SourceLabel | null;
  dataInformed: boolean;
  metricsSnapshot: {
    range: DateRange;
    capturedAt: string;
    metrics: { key: string; label: string; unit: Unit; kind: "observed" | "calculated"; value: number | null; provisional: boolean }[];
  } | null;
  provider: string;
  model: string;
  modelLabel: string;
  image: ImageInfo | null;
  error: { code: string; message: string } | null;
  parentId: string | null;
  durationMs: number | null;
  attempts: number | null;
  cost: { status: "reported"; usd: number; source: "provider" } | { status: "unavailable"; usd: null; reason: string };
  runId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreativeSummary = Pick<
  Creative,
  "id" | "status" | "title" | "aspectRatio" | "dataInformed" | "source" | "sourceLabel" | "modelLabel" | "createdAt" | "image" | "error" | "parentId"
> & { headline: string };

export type CreativeList = { items: CreativeSummary[]; total: number; page: number; limit: number };

export type CreativeListQuery = {
  q?: string;
  status?: CreativeStatus;
  basis?: "data" | "exploratory";
  campaignId?: string;
  page?: number;
  limit?: number;
};

/** What the browser sends to generate an image; the server re-checks the evidence. */
export type GenerateRequest = {
  idempotencyKey: string;
  /** Images to generate, 1 to `image.countMax`; each is its own creative and paid request. */
  count?: number;
  concept: Omit<CreativeConcept, "conceptId"> & { conceptId?: string };
  copy: CreativeCopy;
  imagePrompt: string;
  aspectRatio: AspectRatio;
  title?: string;
  source?: CreativeSource;
  parentId?: string;
};

/** The creatives one image request made, in order; some may have failed. */
export type GenerateResult = { creatives: Creative[]; requested: number; replayed: boolean };

export type StudioConfig = {
  image: {
    enabled: boolean;
    disabledReason: string | null;
    provider: string;
    model: { id: string; label: string };
    aspectRatios: AspectRatio[];
    defaultAspectRatio: AspectRatio;
    dailyLimit: number;
    usedToday: number;
    countMax: number;
    costNote: string;
  };
  concepts: { enabled: boolean; disabledReason: string | null };
  limits: { briefField: number; imagePrompt: number; maxDays: number };
  data: { firstDate: string; lastDate: string };
};

/** A server action's outcome: data, or an API error to show. */
export type CreativeActionResult<T> = { ok: true; data: T; message?: string } | { ok: false; code: string; error: string };
