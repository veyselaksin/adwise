import Type from "typebox";
import { DateRange, IsoDate, literals } from "./common.schema.js";

const Money = (description: string, example: number) => Type.Number({ description, examples: [example] });
const MaybeMoney = (description: string, example: number) =>
  Type.Union([Type.Number(), Type.Null()], { description: `${description}; null without a denominator`, examples: [example] });

export const BriefItem = Type.Object(
  {
    id: Type.String({ examples: ["cpt:c_201"] }),
    kind: literals(["cost_per_trial", "cac", "pacing", "release"], { examples: ["cost_per_trial"] }),
    tone: literals(["bad", "good", "info"], { description: "bad needs a look, good is worth knowing, info is context", examples: ["bad"] }),
    title: Type.String({ examples: ["TikTok BR: cost per trial up 24.1% yesterday"] }),
    detail: Type.String({ examples: ["LIV_TT_BR_Subs: $6.10 on 212 trials, against $4.92 for Oct 5–11."] }),
    investigate: Type.Optional(
      Type.Object({
        campaignId: Type.String({ examples: ["c_201"] }),
        from: IsoDate,
        to: IsoDate,
      }),
    ),
  },
  { title: "BriefItem" },
);

export const Brief = Type.Object(
  {
    date: { ...IsoDate, description: "Yesterday, the last day in the data", examples: ["2026-10-14"] },
    week: DateRange,
    weekBefore: DateRange,
    cacFinalThrough: IsoDate,
    yesterday: Type.Object({
      spend: Money("Spend yesterday", 9876.54),
      trials: Type.Integer({ examples: [812] }),
      subscriptions: Type.Integer({ examples: [49] }),
      cost_per_trial: MaybeMoney("Spend ÷ trials", 12.23),
      cac: MaybeMoney("Spend ÷ subscriptions (not final for yesterday)", 200.25),
      cacFinal: Type.Boolean({ examples: [false] }),
    }),
    baseline: Type.Object({
      avgDailySpend: Money("Last week's spend ÷ 7", 9500.12),
      cost_per_trial: MaybeMoney("Last week's spend ÷ trials", 12.02),
      cac: MaybeMoney("Last week's spend ÷ subscriptions", 27.62),
      cacFinal: Type.Boolean({ examples: [true] }),
    }),
    previousWeekCac: MaybeMoney("CAC for the week before last week", 26.9),
    headline: Type.String({ examples: ["Yesterday $9,876.54 was spent (+3.9% against last week's daily average)…"] }),
    items: Type.Array(BriefItem),
    more: Type.Integer({ description: "Items not shown", examples: [0] }),
  },
  { title: "Brief" },
);
