import Type from "typebox";

const status = Type.String({ examples: ["active"] });
export const Entities = Type.Object(
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
