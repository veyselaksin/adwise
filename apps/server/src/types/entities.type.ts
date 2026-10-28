export type Campaign = { id: string; name: string; channel: string; country: string; status: string };

export type AdSet = { id: string; campaign_id: string; name: string; status: string; daily_budget_usd: number };

export type Ad = { id: string; adset_id: string; name: string; creative_type: string; status: string; created_at: string };

export type Entities = { campaigns: Campaign[]; adsets: AdSet[]; ads: Ad[] };
