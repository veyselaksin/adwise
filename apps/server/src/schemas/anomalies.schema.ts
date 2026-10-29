import Type from "typebox";
import { ANOMALY_TYPES } from "../constants/anomalies.constant.js";
import { DateRange, IsoDate, literals } from "./common.schema.js";

const Severity = literals(["high", "medium", "low"], { examples: ["medium"] });
const AnomalyType = literals(ANOMALY_TYPES, { examples: ["cac_increase"] });
const Metric = literals(["spend", "subscriptions", "cac", "d7_roas", "ctr", "cpc"], { examples: ["cac"] });
const Unit = literals(["usd", "count", "ratio"], { examples: ["usd"] });

export const AnomalyQuery = Type.Object({
  from: Type.Optional({ ...IsoDate, description: "First day to check. With `to`; both omitted = the last 14 days" }),
  to: Type.Optional({ ...IsoDate, description: "Last day to check, inclusive", examples: ["2026-10-14"] }),
  channel: Type.Optional(literals(["meta", "tiktok"], { examples: ["meta"] })),
  country: Type.Optional(literals(["US", "GB", "DE", "BR"], { examples: ["BR"] })),
  type: Type.Optional({ ...AnomalyType, description: "Only this rule" }),
  capped: Type.Optional(
    literals(["show", "hide"], {
      description: "`hide` leaves out flags capped at low (newest final day, small samples) and summarizes them in `hiddenCapped`. Default `show`",
      examples: ["hide"],
    }),
  ),
});

const CampaignRef = Type.Object({
  id: Type.String({ examples: ["c_104"] }),
  name: Type.String({ examples: ["LIV_META_BR_Subs"] }),
  channel: Type.String({ examples: ["meta"] }),
  country: Type.String({ examples: ["BR"] }),
});

const SkipCounts = Type.Object(
  {
    short_history: Type.Integer({ description: "Too few comparable days before the checked day", examples: [588] }),
    not_final: Type.Integer({ description: "The metric isn't final yet for the day (team maturity rule)", examples: [84] }),
    low_volume: Type.Integer({ description: "Under the rule's volume floor, or a zero denominator", examples: [5] }),
    no_data: Type.Integer({ description: "No row for the campaign on the day", examples: [0] }),
    flat_baseline: Type.Integer({ description: "Baseline median of 0, so no relative change", examples: [0] }),
  },
  { description: "Checks that couldn't run, by reason" },
);

export const Anomaly = Type.Object(
  {
    id: Type.String({ description: "campaign:type:date, unique per report", examples: ["c_104:cac_increase:2026-10-08"] }),
    type: AnomalyType,
    typeLabel: Type.String({ examples: ["CAC increase"] }),
    severity: Severity,
    campaign: CampaignRef,
    date: IsoDate,
    dayType: literals(["weekday", "weekend"], { examples: ["weekday"] }),
    metric: Metric,
    metricLabel: Type.String({ examples: ["CAC"] }),
    definition: Type.String({ examples: ["Spend ÷ subscriptions"] }),
    unit: Unit,
    observed: Type.Number({ description: "The day's value (ratios as 0–1)", examples: [23.18] }),
    baseline: Type.Number({ description: "Median of the baseline days", examples: [14.84] }),
    spread: Type.Number({ description: "Usual day-to-day spread (1.4826 × MAD, floored at 5% of the median)", examples: [1.7] }),
    history: Type.Array(Type.Object({ date: IsoDate, value: Type.Number({ examples: [14.2] }) }), {
      description: "The baseline days' values, oldest first",
    }),
    absChange: Type.Number({ examples: [8.34] }),
    pctChange: Type.Union([Type.Number(), Type.Null()], { description: "Relative change; null when the baseline is 0", examples: [0.562] }),
    score: Type.Number({ description: "Robust z-score: (value − median) ÷ (1.4826 × MAD)", examples: [4.9] }),
    baselineWindow: Type.Object({
      from: IsoDate,
      to: IsoDate,
      days: Type.Integer({ description: "Days in the baseline", examples: [20] }),
    }),
    rule: Type.String({ description: "The rule that fired, with its thresholds" }),
    explanation: Type.String({ description: "What was measured, generated from the numbers" }),
    caveat: Type.Optional(Type.String({ description: "Why the flag is capped at low, when it is" })),
    caps: Type.Array(literals(["settling", "small_sample"]), { description: "Why the flag is capped at low; empty when it isn't" }),
    volume: Type.String({ examples: ["25 subscriptions"] }),
    spend: Type.Optional(
      Type.Object({
        observed: Type.Number({ examples: [612.4] }),
        baseline: Type.Number({ examples: [598.1] }),
        pctChange: Type.Union([Type.Number(), Type.Null()], { examples: [0.024] }),
      }),
    ),
    investigate: Type.Object({ campaignId: Type.String({ examples: ["c_104"] }), from: IsoDate, to: IsoDate }),
  },
  { title: "Anomaly" },
);

export const AnomalyReport = Type.Object(
  {
    range: DateRange,
    filters: Type.Object({
      channel: Type.Union([Type.String(), Type.Null()]),
      country: Type.Union([Type.String(), Type.Null()]),
      type: Type.Union([AnomalyType, Type.Null()]),
      capped: literals(["show", "hide"]),
    }),
    finalThrough: Type.Object({ cac: IsoDate, subscriptions: IsoDate, d7_roas: IsoDate }),
    summary: Type.Object({
      total: Type.Integer({ examples: [12] }),
      bySeverity: Type.Object({ high: Type.Integer(), medium: Type.Integer(), low: Type.Integer() }),
      byType: Type.Record(Type.String(), Type.Integer()),
      campaigns: Type.Array(
        Type.Object({
          campaign: CampaignRef,
          count: Type.Integer({ examples: [3] }),
          topSeverity: Severity,
          types: Type.Array(AnomalyType),
        }),
      ),
      campaignsChecked: Type.Integer({ examples: [7] }),
    }),
    coverage: Type.Object({ checks: Type.Integer({ examples: [2058] }), skipped: SkipCounts }),
    hiddenCapped: Type.Union(
      [
        Type.Object({
          total: Type.Integer({ examples: [7] }),
          settling: Type.Array(
            Type.Object({
              date: IsoDate,
              campaigns: Type.Integer({ examples: [6] }),
              metrics: Type.Array(Type.String(), { examples: [["CAC", "Subscriptions"]] }),
            }),
          ),
          smallSample: Type.Integer({ examples: [1] }),
        }),
        Type.Null(),
      ],
      { description: "With capped=hide: the flags left out, summarized; null otherwise" },
    ),
    method: Type.Object({
      lookbackDays: Type.Integer({ examples: [28] }),
      splitWeekends: Type.Boolean(),
      minBaselineDays: Type.Integer({ examples: [6] }),
      minScore: Type.Number({ examples: [3] }),
      severity: Type.Object({
        medium: Type.Object({ score: Type.Number(), changeMultiple: Type.Number() }),
        high: Type.Object({ score: Type.Number(), changeMultiple: Type.Number() }),
      }),
      rules: Type.Array(
        Type.Object({
          type: AnomalyType,
          label: Type.String(),
          metric: Metric,
          definition: Type.String(),
          direction: literals(["up", "down"]),
          minChange: Type.Number(),
          volume: Type.String(),
        }),
      ),
    }),
    anomalies: Type.Array(Anomaly),
  },
  { title: "AnomalyReport" },
);
