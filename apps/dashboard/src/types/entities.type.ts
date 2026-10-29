export type Entities = {
  campaigns: { id: string; name: string; channel: string; country: string; status: string }[];
  adsets: { id: string; campaign_id: string; name: string; status: string; daily_budget_usd: number }[];
  ads: { id: string; adset_id: string; name: string; creative_type: string; status: string; created_at: string }[];
};
