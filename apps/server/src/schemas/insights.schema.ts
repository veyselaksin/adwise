import Type from "typebox";
import { INSIGHT_SORTS, INSIGHT_TITLE_MAX_CHARS, INSIGHTS_MAX, SNAPSHOT_MAX_TOKEN_CHARS } from "../constants/insights.constant.js";
import { DateRange, IsoDate, literals } from "./common.schema.js";
import { MetricKey } from "./metrics.schema.js";

/** A tool's arguments or output: whatever the tool takes or returns, kept as is. */
const AnyObject = Type.Object({}, { additionalProperties: true });

const InsightTitle = Type.String({
  minLength: 1,
  maxLength: 500,
  description: `The report's name. Whitespace is collapsed; longer than ${INSIGHT_TITLE_MAX_CHARS} characters is shortened.`,
  examples: ["CAC by channel, last week"],
});

const SnapshotToken = Type.String({
  minLength: 1,
  maxLength: SNAPSHOT_MAX_TOKEN_CHARS,
  description: "The `token` of the agent stream's `snapshot` event for the answer being saved. It is signed by the server; a changed token is refused.",
  examples: ["eyJ2IjoxLCJhbnN3ZXJlZEF0Ijoi….Qm9uZ1N…"],
});

const Evidence = Type.Object(
  {
    id: Type.String({ examples: ["1.1"] }),
    tool: Type.String({ examples: ["query_metrics"] }),
    label: Type.String({ examples: ["spend, cac by channel · last week"] }),
    args: AnyObject,
    ok: Type.Boolean(),
    summary: Type.String({ examples: ["2 rows · total spend $61,556.50"] }),
    data: Type.Union([AnyObject, Type.Null()], { description: "The tool's output exactly as the model read it; null when it was too large to keep" }),
    truncated: Type.Optional(Type.Literal(true)),
  },
  { title: "InsightEvidence" },
);

const Snapshot = Type.Object(
  {
    v: Type.Literal(1),
    answeredAt: Type.String({ format: "date-time" }),
    question: Type.String({ examples: ["What was our CAC by channel last week?"] }),
    earlierQuestions: Type.Array(Type.String(), { description: "Earlier questions of the conversation, for follow-ups" }),
    answer: Type.String({ description: "The agent's answer, Markdown", examples: ["**Blended CAC last week was $27.41.** …"] }),
    notes: Type.Array(Type.String(), { description: "The model's remarks between lookups" }),
    model: Type.Object({ id: Type.String({ examples: ["deepseek/deepseek-v4.1-flash"] }), label: Type.String({ examples: ["DeepSeek V4.1 Flash"] }) }),
    dataToday: IsoDate,
    evidence: Type.Array(Evidence),
  },
  { title: "InsightSnapshot", description: "Frozen when the answer was given; never re-run." },
);

const Scope = Type.Object(
  {
    period: Type.Union([DateRange, Type.Null()], { description: "Every period the lookups covered, as one span" }),
    ranges: Type.Array(DateRange),
    channels: Type.Array(Type.String(), { examples: [["meta"]] }),
    countries: Type.Array(Type.String(), { examples: [["US"]] }),
    campaigns: Type.Array(
      Type.Object({ id: Type.String(), name: Type.String(), channel: Type.String(), country: Type.String() }),
    ),
    metrics: Type.Array(
      Type.Object({
        key: MetricKey,
        label: Type.String({ examples: ["CAC"] }),
        unit: literals(["usd", "count", "ratio"]),
        formula: Type.Optional(Type.String({ examples: ["spend ÷ subscriptions"] })),
        finalAfterDays: Type.Integer({ examples: [4] }),
      }),
    ),
  },
  { title: "InsightScope", description: "Read from the evidence when saved, not from the answer's wording" },
);

const Caveat = Type.Object({
  kind: literals(["not_final", "rows_omitted", "lookup_failed", "evidence_truncated"]),
  text: Type.String({ examples: ["cac includes install days that weren't final yet; it was final through 2026-10-11"] }),
});

const draftFields = {
  title: InsightTitle,
  summary: Type.String({ description: "The answer's lead sentence", examples: ["Blended CAC last week was $27.41."] }),
  snapshot: Snapshot,
  scope: Scope,
  caveats: Type.Array(Caveat),
};

export const InsightDraft = Type.Object(draftFields, { title: "InsightDraft" });

export const Insight = Type.Object(
  {
    id: Type.String({ format: "uuid", examples: ["3f1c2a8e-7c1d-4b8a-9a52-1d2f3e4a5b6c"] }),
    ...draftFields,
    owner: Type.String({ description: "The account that saved it", examples: ["marketing"] }),
    mine: Type.Boolean({ description: "Whether the caller saved it (and so may rename or delete it)" }),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { title: "Insight" },
);

export const InsightSummary = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    title: InsightTitle,
    summary: Type.String(),
    owner: Type.String({ examples: ["marketing"] }),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    question: Type.String(),
    period: Type.Union([DateRange, Type.Null()]),
    campaigns: Type.Array(Type.String(), { examples: [["US_Meta_Prospecting"]] }),
    model: Type.String({ examples: ["DeepSeek V4.1 Flash"] }),
    evidenceCount: Type.Integer({ examples: [2] }),
    mine: Type.Boolean({ description: "Whether the caller saved it" }),
  },
  { title: "InsightSummary" },
);

export const InsightList = Type.Array(InsightSummary, { maxItems: INSIGHTS_MAX });

export const InsightParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export const InsightListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200, description: "Matches the title, the question or a campaign name", examples: ["cac"] })),
  sort: Type.Optional(literals(INSIGHT_SORTS, { default: "newest", description: "By save time" })),
  from: Type.Optional({ ...IsoDate, description: "Saved on or after this day (UTC)" }),
  to: Type.Optional({ ...IsoDate, description: "Saved on or before this day (UTC)" }),
});

export const SnapshotBody = Type.Object({ token: SnapshotToken }, { title: "InsightPreviewRequest" });

export const NewInsight = Type.Object({ token: SnapshotToken, title: InsightTitle }, { title: "NewInsight" });

export const InsightChanges = Type.Object({ title: InsightTitle }, { title: "InsightChanges" });
