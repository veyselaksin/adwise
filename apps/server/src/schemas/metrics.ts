import Type, { type TSchemaOptions } from "typebox";
import { DATE_PATTERN, RANGE_PRESETS } from "../metrics/dates.js";
import { BASE_METRICS, DERIVED_METRICS, METRIC_KEYS } from "../metrics/definitions.js";
import { DIMENSIONS, MAX_LIMIT } from "../metrics/query.js";

const literals = <const T extends string[]>(values: readonly [...T], opts: TSchemaOptions = {}) =>
  Type.Enum(values, opts);

export const IsoDate = Type.String({ pattern: DATE_PATTERN, examples: ["2026-10-05"] });

export const DateRange = Type.Object(
  {
    from: { ...IsoDate, description: "First install day, inclusive" },
    to: { ...IsoDate, description: "Last install day, inclusive", examples: ["2026-10-11"] },
  },
  { title: "DateRange" },
);

export const MetricKey = literals(METRIC_KEYS, { title: "MetricKey", examples: ["cac"] });
export const Dimension = literals(DIMENSIONS, { title: "Dimension", examples: ["channel"] });
export const RangePreset = literals(RANGE_PRESETS, {
  title: "RangePreset",
  description:
    "The team's named periods. `last_N_days` are the N full days ending yesterday; `last_week` is the previous Monday to Sunday.",
  examples: ["last_week"],
});

const ids = (description: string, example: string) =>
  Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 100, description, examples: [[example]] }));

export const MetricsQueryBody = Type.Object(
  {
    preset: Type.Optional(RangePreset),
    range: Type.Optional({ ...DateRange, description: "Explicit range; ignored when `preset` is set" }),
    groupBy: Type.Optional(
      Type.Array(Dimension, {
        maxItems: 4,
        description:
          "Split rows by these. `ad` also returns its ad set, campaign, channel and country; `adset` its campaign, channel and country.",
        examples: [["country", "channel"]],
      }),
    ),
    filters: Type.Optional(
      Type.Object({
        channels: ids("`meta` or `tiktok`", "meta"),
        countries: ids("`US`, `GB`, `DE` or `BR`", "US"),
        campaignIds: ids("Campaign ids", "c_101"),
        adsetIds: ids("Ad set ids", "as_1012"),
        adIds: ids("Ad ids", "ad_3001"),
        creativeTypes: ids("`video` or `image`", "video"),
        adStatus: Type.Optional(literals(["active", "paused"], { description: "Current ad status" })),
      }),
    ),
    orderBy: Type.Optional(
      Type.Object({
        metric: MetricKey,
        direction: literals(["asc", "desc"], { examples: ["asc"] }),
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT, examples: [10] })),
    compare: Type.Optional(
      Type.Boolean({
        description: "Also return totals for the previous period of the same length",
        examples: [true],
      }),
    ),
  },
  { title: "MetricsQuery" },
);

const optionalString = (description: string, example: string) =>
  Type.Optional(Type.String({ description, examples: [example] }));
const nullableNumber = (description: string, example: number) =>
  Type.Union([Type.Number(), Type.Null()], { description, examples: [example] });

const BASE_DESCRIPTIONS: Record<(typeof BASE_METRICS)[number], [string, number]> = {
  spend: ["Spend in USD", 37142.36],
  impressions: ["Impressions", 3_052_341],
  clicks: ["Clicks", 36_102],
  installs: ["Installs (first app opens attributed to an ad)", 23_541],
  trials: ["Free trials started", 2_369],
  trial_conversions: ["Trials that became paid", 958],
  subscriptions: ["New paying users, through a trial or directly", 1_090],
  d7_revenue: ["Revenue in USD from users' first 7 days", 32_105.12],
};
const DERIVED_DESCRIPTIONS: Record<(typeof DERIVED_METRICS)[number], [string, number]> = {
  cpi: ["Spend ÷ installs", 1.58],
  cac: ["Spend ÷ subscriptions", 34.08],
  cost_per_trial: ["Spend ÷ trials", 15.68],
  trial_to_sub: ["Trial conversions ÷ trials (0–1)", 0.401],
  d7_roas: ["D7 revenue ÷ spend (0–1+)", 0.879],
  ctr: ["Clicks ÷ impressions (0–1)", 0.0118],
};

export const MetricRow = Type.Object(
  {
    date: optionalString("Install day (when grouped by `date`)", "2026-10-14"),
    week: optionalString("Monday of the week (when grouped by `week`)", "2026-10-05"),
    month: optionalString("`YYYY-MM` (when grouped by `month`)", "2026-10"),
    channel: optionalString("`meta` or `tiktok`", "meta"),
    country: optionalString("Country code", "US"),
    campaign_id: optionalString("Campaign id", "c_101"),
    campaign_name: optionalString("Campaign name", "LIV_META_US_Subs"),
    adset_id: optionalString("Ad set id", "as_1012"),
    adset_name: optionalString("Ad set name", "US_Broad_02"),
    ad_id: optionalString("Ad id", "ad_3004"),
    ad_name: optionalString("Ad name; not unique, show it with the ad set", "Before_After_v4"),
    ad_status: optionalString("`active` or `paused`", "active"),
    creative_type: optionalString("`video` or `image`", "video"),
    ...Object.fromEntries(
      BASE_METRICS.map((m) => {
        const [description, example] = BASE_DESCRIPTIONS[m];
        return [m, Type.Number({ description, examples: [example] })];
      }),
    ),
    ...Object.fromEntries(
      DERIVED_METRICS.map((m) => {
        const [description, example] = DERIVED_DESCRIPTIONS[m];
        return [m, nullableNumber(`${description}; null when the denominator is 0`, example)];
      }),
    ),
    provisional: Type.Array(MetricKey, {
      description: "Metrics that include install days too recent to be final (e.g. CAC for days < 4 days old)",
      examples: [["cac", "trial_to_sub", "d7_roas"]],
    }),
  },
  { title: "MetricRow" },
);

export const MetricsResult = Type.Object(
  {
    range: DateRange,
    groupBy: Type.Array(Dimension),
    rows: Type.Array(MetricRow),
    totals: { ...MetricRow, description: "All rows combined (before `limit`): the blended number" },
    previous: Type.Optional(
      Type.Object(
        { range: DateRange, totals: MetricRow },
        { description: "Same-length period just before `range`, when `compare` is true" },
      ),
    ),
  },
  { title: "MetricsResult" },
);

export const MetricDefinition = Type.Object(
  {
    key: MetricKey,
    label: Type.String({ examples: ["CAC"] }),
    unit: literals(["usd", "count", "ratio"], { examples: ["usd"] }),
    better: literals(["higher", "lower", "neutral"], { examples: ["lower"] }),
    formula: Type.Optional(
      Type.String({ description: "Derived metrics only", examples: ["spend ÷ subscriptions"] }),
    ),
    finalAfterDays: Type.Integer({
      description: "An install day's value keeps changing until it is this many days old",
      examples: [4],
    }),
    lastFinalDate: { ...IsoDate, description: "Latest install day whose value is final" },
  },
  { title: "MetricDefinition" },
);

export const Catalog = Type.Object(
  {
    today: { ...IsoDate, description: "The day after the last day in the data", examples: ["2026-10-15"] },
    firstDataDate: { ...IsoDate, examples: ["2026-09-03"] },
    lastDataDate: { ...IsoDate, description: "\"Yesterday\"", examples: ["2026-10-14"] },
    metrics: Type.Array(MetricDefinition),
    dimensions: Type.Array(Dimension),
    presets: Type.Array(Type.Object({ key: RangePreset, range: DateRange })),
  },
  { title: "Catalog" },
);

const status = Type.String({ examples: ["active"] });
export const EntitiesSchema = Type.Object(
  {
    campaigns: Type.Array(
      Type.Object({
        id: Type.String({ examples: ["c_101"] }),
        name: Type.String({ examples: ["LIV_META_US_Subs"] }),
        channel: Type.String({ examples: ["meta"] }),
        country: Type.String({ examples: ["US"] }),
        status,
      }),
    ),
    adsets: Type.Array(
      Type.Object({
        id: Type.String({ examples: ["as_1012"] }),
        campaign_id: Type.String({ examples: ["c_101"] }),
        name: Type.String({ examples: ["US_Broad_02"] }),
        status,
        daily_budget_usd: Type.Number({ examples: [1080] }),
      }),
    ),
    ads: Type.Array(
      Type.Object({
        id: Type.String({ examples: ["ad_3001"] }),
        adset_id: Type.String({ examples: ["as_1011"] }),
        name: Type.String({ examples: ["Hero_Intro_v1"] }),
        creative_type: Type.String({ examples: ["video"] }),
        status,
        created_at: Type.String({ examples: ["2026-08-12T09:00:00Z"] }),
      }),
    ),
  },
  { title: "Entities" },
);
