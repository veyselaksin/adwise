import Type, { type TSchema } from "typebox";
import { AGENT_MODEL_IDS } from "../constants/agent.constant.js";
import {
  BRIEF_FIELD_MAX,
  BRIEF_FIELDS,
  BRIEF_SUGGESTION_LIMITS,
  CONCEPT_LIMITS,
  CREATIVE_STATUSES,
  CREATIVES_PAGE,
  IMAGE_ASPECT_RATIOS,
  IMAGE_COUNT_MAX,
  IMAGE_MODEL_IDS,
  IMAGE_PROMPT_MAX,
} from "../constants/creatives.constant.js";
import { DateRange, IsoDate, literals } from "./common.schema.js";

const Id = (description: string, example: string) => Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$", description, examples: [example] });
const Uuid = Type.String({ format: "uuid", examples: ["3f1c2a8e-7c1d-4b8a-9a52-1d2f3e4a5b6c"] });
const Text = (max: number, description: string, example: string) => Type.String({ maxLength: max, description, examples: [example] });
const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);

export const AspectRatio = literals([...IMAGE_ASPECT_RATIOS], { description: "Image aspect ratio the image model supports", examples: ["1:1"] });

export const CreativeSource = Type.Object(
  {
    campaignId: Id("Campaign id from GET /entities", "c_101"),
    adsetId: Type.Optional(Id("One of the campaign's ad sets, to narrow the context", "as_1011")),
    adId: Type.Optional(Id("One of the ad set's ads; needs `adsetId`", "ad_10111")),
    from: { ...IsoDate, description: "First install day, inclusive", examples: ["2026-10-01"] },
    to: { ...IsoDate, description: "Last install day, inclusive", examples: ["2026-10-14"] },
  },
  { title: "CreativeSource" },
);

export const ContextQuery = CreativeSource;

const Brief = Type.Object(
  {
    productContext: Type.Optional(Text(BRIEF_FIELD_MAX, "What's being advertised, in the user's words", "Livensa: a habit-tracking app with a 3-day free trial")),
    targetAudience: Type.Optional(Text(BRIEF_FIELD_MAX, "Who the ad is for", "Busy parents in their 30s")),
    desiredMessage: Type.Optional(Text(BRIEF_FIELD_MAX, "What the ad should say", "Small daily steps add up")),
    brandVoice: Type.Optional(Text(BRIEF_FIELD_MAX, "Tone", "Warm, plain-spoken, a little playful")),
    visualPreferences: Type.Optional(Text(BRIEF_FIELD_MAX, "Look and feel", "Natural light, real homes, no stock-photo smiles")),
    constraints: Type.Optional(Text(BRIEF_FIELD_MAX, "Must and must-not", "No before/after body imagery")),
  },
  { title: "CreativeBrief" },
);

export const ConceptsBody = Type.Object(
  {
    source: Type.Optional(CreativeSource),
    brief: Type.Optional(Brief),
    aspectRatio: Type.Optional(AspectRatio),
    model: Type.Optional(literals(AGENT_MODEL_IDS, { description: "Text model that writes the concepts (see GET /agent/models). Default: AGENT_MODEL.", examples: [AGENT_MODEL_IDS[0]] })),
  },
  { title: "ConceptsRequest" },
);

const ModelId = literals(AGENT_MODEL_IDS, { description: "Text model to use (see GET /agent/models). Default: AGENT_MODEL.", examples: [AGENT_MODEL_IDS[0]] });

export const BriefSuggestBody = Type.Object(
  {
    source: Type.Optional(CreativeSource),
    brief: Type.Optional(Brief),
    model: Type.Optional(ModelId),
  },
  { title: "BriefSuggestRequest" },
);

/** The brief suggestions the text model must answer with; unknown fields are dropped later, not rejected. */
export const ModelBrief = Type.Object({
  suggestions: Type.Array(
    Type.Object({
      field: Type.String(),
      value: Type.String({ minLength: 1 }),
      basis: Type.Optional(Type.String()),
      note: Type.Optional(Type.String()),
    }),
  ),
});

/** What the text model must answer with. Lengths aren't enforced here: longer text is cut, not rejected. */
export const ModelConcepts = Type.Object({
  concepts: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1 }),
      creativeRationale: Type.String({ minLength: 1 }),
      targetAudience: Type.String(),
      coreMessage: Type.String(),
      visualDescription: Type.String(),
      composition: Type.String(),
      suggestedHeadline: Type.String({ minLength: 1 }),
      suggestedPrimaryText: Type.String({ minLength: 1 }),
      suggestedCallToAction: Type.String({ minLength: 1 }),
      imagePrompt: Type.String({ minLength: 1 }),
      aspectRatio: Type.Optional(Type.String()),
      performanceEvidence: Type.Optional(Type.Array(Type.Object({ evidenceId: Type.String(), observation: Type.String() }))),
      assumptions: Type.Optional(Type.Array(Type.String())),
      testHypothesis: Type.String({ minLength: 1 }),
    }),
    { minItems: 1 },
  ),
});

const Evidence = Type.Object(
  {
    evidenceId: Type.String({ examples: ["metric:ctr"] }),
    label: Type.String({ examples: ["CTR"] }),
    observation: Type.String({ examples: ["CTR rose from 1.1% to 1.4% against the previous period."] }),
  },
  { title: "ConceptEvidence" },
);

const conceptFields = {
  title: Text(CONCEPT_LIMITS.title, "Short name", "Morning routine, real kitchen"),
  creativeRationale: Text(CONCEPT_LIMITS.text, "Why this concept, citing the data where it can", "CTR is above the previous period while CAC rose…"),
  targetAudience: Text(CONCEPT_LIMITS.text, "Who it's for (from the brief or stated as an assumption)", "Parents building a morning habit"),
  coreMessage: Text(CONCEPT_LIMITS.text, "The single idea", "Two minutes a day is enough to start"),
  visualDescription: Text(CONCEPT_LIMITS.text, "What the image shows", "A phone propped against a coffee mug…"),
  composition: Text(CONCEPT_LIMITS.text, "Framing and layout", "Close-up, phone in the left third, space on the right for copy"),
  suggestedHeadline: Text(CONCEPT_LIMITS.headline, "Ad headline", "Start small. Keep going."),
  suggestedPrimaryText: Text(CONCEPT_LIMITS.primaryText, "Ad body text", "Build one habit at a time with a 3-day free trial."),
  suggestedCallToAction: Text(CONCEPT_LIMITS.callToAction, "Button text", "Start free trial"),
  imagePrompt: Text(IMAGE_PROMPT_MAX, "What the image model is asked for (no business data)", "Photorealistic close-up of a smartphone…"),
  aspectRatio: AspectRatio,
  performanceEvidence: Type.Array(Evidence, { description: "Measured observations the concept builds on; each cites its evidence id. Empty for exploratory concepts." }),
  assumptions: Type.Array(Type.String(), { description: "What the concept assumes without data to show it" }),
  testHypothesis: Text(CONCEPT_LIMITS.text, "What a test of this concept would check; a hypothesis, not a prediction", "If the image shows the app in use, CTR may rise…"),
};

export const Concept = Type.Object({ conceptId: Type.String({ examples: ["cn_1a2b3c4d"] }), ...conceptFields }, { title: "CreativeConcept" });

/** A concept as the client sends it back to generate an image; the user may have edited any text. */
const ConceptInput = Type.Object(
  {
    conceptId: Type.Optional(Type.String({ maxLength: 64 })),
    ...conceptFields,
    performanceEvidence: Type.Array(
      Type.Object({
        evidenceId: Type.String({ maxLength: 64, examples: ["metric:ctr"] }),
        label: Type.Optional(Type.String({ maxLength: 120, description: "Ignored: the server sets the label from the evidence id" })),
        observation: Type.String({ maxLength: CONCEPT_LIMITS.text }),
      }),
      { maxItems: CONCEPT_LIMITS.listItems, description: "Re-checked against the source's data; items that no longer match are dropped" },
    ),
    assumptions: Type.Array(Type.String({ maxLength: CONCEPT_LIMITS.text }), { maxItems: CONCEPT_LIMITS.listItems }),
  },
  { title: "CreativeConceptInput" },
);

const Copy = Type.Object(
  {
    headline: Type.String({ minLength: 1, maxLength: CONCEPT_LIMITS.headline, examples: ["Start small. Keep going."] }),
    primaryText: Type.String({ minLength: 1, maxLength: CONCEPT_LIMITS.primaryText, examples: ["Build one habit at a time."] }),
    callToAction: Type.String({ minLength: 1, maxLength: CONCEPT_LIMITS.callToAction, examples: ["Start free trial"] }),
  },
  { title: "CreativeCopy" },
);

export const GenerateBody = Type.Object(
  {
    idempotencyKey: { ...Uuid, description: "A new UUID per deliberate request. Sending the same key again returns the same creatives instead of paying for more images." },
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: IMAGE_COUNT_MAX, default: 1, description: `Images to generate (1–${IMAGE_COUNT_MAX}). Each is a separate paid request and its own creative.`, examples: [2] })),
    concept: ConceptInput,
    copy: Copy,
    imagePrompt: Type.String({ minLength: 10, maxLength: IMAGE_PROMPT_MAX, description: "Sent to the image provider (plus a fixed no-text instruction)", examples: ["Photorealistic close-up of a smartphone on a kitchen counter at sunrise"] }),
    aspectRatio: AspectRatio,
    title: Type.Optional(Type.String({ maxLength: CONCEPT_LIMITS.title, examples: ["Morning routine, real kitchen"] })),
    source: Type.Optional(CreativeSource),
    parentId: Type.Optional({ ...Uuid, description: "The saved creative this is a new variation of" }),
  },
  { title: "GenerateCreativeRequest" },
);

export const CreativeParams = Type.Object({ id: Uuid });

export const CreativeChanges = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: CONCEPT_LIMITS.title, examples: ["Morning routine v2"] })),
    copy: Type.Optional(Type.Partial(Copy)),
  },
  { title: "CreativeChanges", minProperties: 1 },
);

export const CreativeListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200, description: "Matches the title, headline or campaign name", examples: ["morning"] })),
  status: Type.Optional(literals([...CREATIVE_STATUSES], { examples: ["succeeded"] })),
  basis: Type.Optional(literals(["data", "exploratory"], { description: "Performance-informed or exploratory", examples: ["data"] })),
  campaignId: Type.Optional(Id("Only creatives made for this campaign", "c_101")),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 1, examples: [1] })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: CREATIVES_PAGE.max, default: CREATIVES_PAGE.default, examples: [CREATIVES_PAGE.default] })),
});

export const ImageQuery = Type.Object({ download: Type.Optional(Type.Boolean({ description: "Send as an attachment" })) });

const Change = { absChange: Nullable(Type.Number()), pctChange: Nullable(Type.Number()) };

const ContextMetric = Type.Object(
  {
    key: Type.String({ examples: ["ctr"] }),
    evidenceId: Type.String({ examples: ["metric:ctr"] }),
    label: Type.String({ examples: ["CTR"] }),
    unit: literals(["usd", "count", "ratio"]),
    kind: literals(["observed", "calculated"], { description: "observed: summed from the warehouse; calculated: a ratio of those sums" }),
    formula: Type.Optional(Type.String({ examples: ["clicks ÷ impressions"] })),
    inGlossary: Type.Boolean(),
    better: literals(["higher", "lower", "neutral"]),
    current: Nullable(Type.Number()),
    previous: Nullable(Type.Number()),
    ...Change,
    assessment: Nullable(literals(["better", "worse"])),
    provisional: Type.Object({ current: Type.Boolean(), previous: Type.Boolean() }),
  },
  { title: "CreativeContextMetric" },
);

const ContextAd = Type.Object(
  {
    evidenceId: Type.String({ examples: ["ad:ad_10111"] }),
    id: Type.String(),
    name: Type.String(),
    adsetName: Type.String(),
    creativeType: Type.String({ examples: ["video"] }),
    status: Type.String(),
    spend: Type.Number(),
    impressions: Type.Number(),
    clicks: Type.Number(),
    ctr: Nullable(Type.Number()),
    installs: Type.Number(),
    cpi: Nullable(Type.Number()),
    subscriptions: Type.Number(),
    cac: Nullable(Type.Number()),
    cacProvisional: Type.Boolean(),
    smallSample: Type.Boolean(),
  },
  { title: "CreativeContextAd" },
);

export const Context = Type.Object(
  {
    source: CreativeSource,
    level: literals(["campaign", "adset", "ad"]),
    campaign: Type.Object({ id: Type.String(), name: Type.String(), channel: Type.String(), country: Type.String(), status: Type.String() }),
    adset: Nullable(Type.Object({ id: Type.String(), name: Type.String(), status: Type.String() })),
    ad: Nullable(Type.Object({ id: Type.String(), name: Type.String(), creativeType: Type.String(), status: Type.String() })),
    range: DateRange,
    days: Type.Integer(),
    comparison: Type.Union([
      Type.Object({ available: Type.Literal(true), range: DateRange }),
      Type.Object({ available: Type.Literal(false), reason: Type.String() }),
    ]),
    status: literals(["ok", "insufficient"]),
    statusReason: Nullable(Type.String()),
    metrics: Type.Array(ContextMetric),
    topAds: Type.Array(ContextAd),
    unavailable: Type.Array(Type.Object({ label: Type.String(), reason: Type.String() })),
    notes: Type.Array(Type.String()),
    smallSample: Type.Boolean(),
  },
  { title: "CreativeContext" },
);

const Usage = Type.Object({ inputTokens: Type.Integer(), outputTokens: Type.Integer() });

export const BriefSuggestResult = Type.Object(
  {
    suggestions: Type.Array(
      Type.Object({
        field: literals([...BRIEF_FIELDS]),
        value: Type.String({ maxLength: BRIEF_SUGGESTION_LIMITS.value }),
        basis: literals(["data", "assumption"], { description: "data: follows from the selection's data; assumption: not in the data" }),
        note: Type.String({ maxLength: BRIEF_SUGGESTION_LIMITS.note, description: "What the suggestion is based on" }),
      }),
    ),
    dataInformed: Type.Boolean(),
    context: Nullable(Context),
    model: Type.Object({ id: Type.String(), label: Type.String() }),
    removed: Type.Integer({ description: "Suggestions or sentences the guardrails removed" }),
    usage: Usage,
    generatedAt: Type.String({ format: "date-time" }),
  },
  { title: "BriefSuggestResult" },
);

export const ConceptsResult = Type.Object(
  {
    concepts: Type.Array(Concept),
    dataInformed: Type.Boolean(),
    exploratoryReason: Nullable(Type.String()),
    context: Nullable(Context),
    model: Type.Object({ id: Type.String(), label: Type.String() }),
    removed: Type.Integer({ description: "Statements the guardrails removed" }),
    usage: Usage,
    generatedAt: Type.String({ format: "date-time" }),
  },
  { title: "ConceptsResult" },
);

const SourceLabel = Type.Object({
  campaign: Type.String(),
  adset: Nullable(Type.String()),
  ad: Nullable(Type.String()),
  channel: Type.String(),
  country: Type.String(),
});

const ImageInfo = Type.Object({
  mimeType: Type.String({ examples: ["image/png"] }),
  bytes: Type.Integer(),
  width: Nullable(Type.Integer()),
  height: Nullable(Type.Integer()),
});

const CreativeError = Type.Object({ code: Type.String({ examples: ["IMAGE_TIMEOUT"] }), message: Type.String() });

export const Creative = Type.Object(
  {
    id: Uuid,
    owner: Type.String(),
    status: literals([...CREATIVE_STATUSES]),
    title: Type.String(),
    concept: Concept,
    copy: Copy,
    imagePrompt: Type.String(),
    aspectRatio: AspectRatio,
    source: Nullable(CreativeSource),
    sourceLabel: Nullable(SourceLabel),
    dataInformed: Type.Boolean(),
    metricsSnapshot: Nullable(
      Type.Object({
        range: DateRange,
        capturedAt: Type.String({ format: "date-time" }),
        metrics: Type.Array(
          Type.Object({
            key: Type.String(),
            label: Type.String(),
            unit: literals(["usd", "count", "ratio"]),
            kind: literals(["observed", "calculated"]),
            value: Nullable(Type.Number()),
            provisional: Type.Boolean(),
          }),
        ),
      }),
    ),
    provider: Type.String({ examples: ["zenmux"] }),
    model: literals([...IMAGE_MODEL_IDS]),
    modelLabel: Type.String({ examples: ["Kling v3"] }),
    image: Nullable(ImageInfo),
    error: Nullable(CreativeError),
    parentId: Nullable(Uuid),
    durationMs: Nullable(Type.Number()),
    attempts: Nullable(Type.Integer()),
    cost: Type.Union([
      Type.Object({ status: Type.Literal("reported"), usd: Type.Number(), source: Type.Literal("provider") }),
      Type.Object({ status: Type.Literal("unavailable"), usd: Type.Null(), reason: Type.String() }),
    ]),
    runId: Nullable(Type.String()),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    completedAt: Nullable(Type.String({ format: "date-time" })),
  },
  { title: "Creative" },
);

export const GenerateResult = Type.Object(
  {
    creatives: Type.Array(Creative, { description: "One creative per image, in order. When some failed and others didn't, the failed ones have `status: failed`." }),
    requested: Type.Integer({ minimum: 1, maximum: IMAGE_COUNT_MAX }),
    replayed: Type.Boolean({ description: "true when the idempotency key had been used: these are the saved creatives, nothing new was requested" }),
  },
  { title: "GenerateResult" },
);

export const CreativeList = Type.Object(
  {
    items: Type.Array(
      Type.Object({
        id: Uuid,
        status: literals([...CREATIVE_STATUSES]),
        title: Type.String(),
        headline: Type.String(),
        aspectRatio: AspectRatio,
        dataInformed: Type.Boolean(),
        source: Nullable(CreativeSource),
        sourceLabel: Nullable(SourceLabel),
        modelLabel: Type.String(),
        createdAt: Type.String({ format: "date-time" }),
        image: Nullable(ImageInfo),
        error: Nullable(CreativeError),
        parentId: Nullable(Uuid),
      }),
    ),
    total: Type.Integer(),
    page: Type.Integer(),
    limit: Type.Integer(),
  },
  { title: "CreativeList" },
);

export const StudioConfig = Type.Object(
  {
    image: Type.Object({
      enabled: Type.Boolean(),
      disabledReason: Nullable(Type.String()),
      provider: Type.String({ examples: ["zenmux"] }),
      model: Type.Object({ id: Type.String({ examples: ["klingai/kling-v3"] }), label: Type.String({ examples: ["Kling v3"] }) }),
      aspectRatios: Type.Array(AspectRatio),
      defaultAspectRatio: AspectRatio,
      dailyLimit: Type.Integer(),
      usedToday: Type.Integer(),
      countMax: Type.Integer({ description: "Images one request may ask for" }),
      costNote: Type.String(),
    }),
    concepts: Type.Object({ enabled: Type.Boolean(), disabledReason: Nullable(Type.String()) }),
    limits: Type.Object({ briefField: Type.Integer(), imagePrompt: Type.Integer(), maxDays: Type.Integer() }),
    data: Type.Object({ firstDate: IsoDate, lastDate: IsoDate }),
  },
  { title: "StudioConfig" },
);
