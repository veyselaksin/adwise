import Type from "typebox";
import { PACING_BAND, PACING_DEFAULT_DAYS, PACING_MAX_DAYS, PACING_STATUSES } from "../constants/budgets.constant.js";
import { DateRange, literals } from "./common.schema.js";

export const PacingQuery = Type.Object({
  days: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: PACING_MAX_DAYS,
      default: PACING_DEFAULT_DAYS,
      description: "Window length: the N full days ending yesterday",
      examples: [PACING_DEFAULT_DAYS],
    }),
  ),
});

const usd = (description: string, example: number) => Type.Number({ description, examples: [example] });

const pacingFields = {
  daily_budget_usd: usd("Current daily budget in USD", 490),
  spend: usd("Total spend over the window", 3670.8),
  avg_daily_spend: usd("Spend ÷ days in the window", 524.4),
  last_day_spend: usd("Spend yesterday", 415.1),
  pace: Type.Union([Type.Number(), Type.Null()], {
    description: "avg_daily_spend ÷ daily_budget_usd (1 = on budget); null without a budget",
    examples: [1.07],
  }),
  pacing: literals(PACING_STATUSES, {
    description: `\`over\` above ${PACING_BAND.over * 100}% of budget, \`under\` below ${PACING_BAND.under * 100}%, \`paused\` for paused ad sets (never flagged)`,
    examples: ["on_pace"],
  }),
};

export const BudgetPacing = Type.Object(
  {
    range: DateRange,
    days: Type.Integer({ examples: [PACING_DEFAULT_DAYS] }),
    band: Type.Object(
      {
        under: Type.Number({ examples: [PACING_BAND.under] }),
        over: Type.Number({ examples: [PACING_BAND.over] }),
      },
      { description: "Pace outside this band is flagged" },
    ),
    adsets: Type.Array(
      Type.Object({
        adset_id: Type.String({ examples: ["as_1021"] }),
        adset_name: Type.String({ examples: ["GB_Broad_01"] }),
        campaign_id: Type.String({ examples: ["c_102"] }),
        status: Type.String({ examples: ["active"] }),
        ...pacingFields,
      }),
    ),
    campaigns: Type.Array(
      Type.Object({
        campaign_id: Type.String({ examples: ["c_102"] }),
        campaign_name: Type.String({ examples: ["LIV_META_GB_Subs"] }),
        channel: Type.String({ examples: ["meta"] }),
        country: Type.String({ examples: ["GB"] }),
        ...pacingFields,
      }),
      { description: "Active ad sets summed per campaign" },
    ),
  },
  { title: "BudgetPacing" },
);
