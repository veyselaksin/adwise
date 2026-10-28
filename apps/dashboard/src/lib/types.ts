// Shapes returned by the API. Client-safe: no secrets, no server imports.

export const BASE_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "installs",
  "trials",
  "trial_conversions",
  "subscriptions",
  "d7_revenue",
] as const;
export const DERIVED_METRICS = ["cpi", "cac", "cost_per_trial", "trial_to_sub", "d7_roas", "ctr"] as const;

export type BaseMetric = (typeof BASE_METRICS)[number];
export type DerivedMetric = (typeof DERIVED_METRICS)[number];
export type MetricKey = BaseMetric | DerivedMetric;

export type Dimension =
  | "date"
  | "week"
  | "month"
  | "channel"
  | "country"
  | "campaign"
  | "adset"
  | "ad"
  | "creative_type";

export type RangePreset =
  | "yesterday"
  | "last_7_days"
  | "last_14_days"
  | "last_28_days"
  | "last_week"
  | "this_week"
  | "this_month"
  | "last_month";

export type DateRange = { from: string; to: string };

export type MetricRow = {
  date?: string;
  week?: string;
  month?: string;
  channel?: string;
  country?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  ad_status?: string;
  creative_type?: string;
  provisional: MetricKey[];
} & Record<BaseMetric, number> &
  Record<DerivedMetric, number | null>;

export type MetricsResult = {
  range: DateRange;
  groupBy: Dimension[];
  rows: MetricRow[];
  totals: MetricRow;
  previous?: { range: DateRange; totals: MetricRow };
};

export type Unit = "usd" | "count" | "ratio";

export type MetricDefinition = {
  key: MetricKey;
  label: string;
  unit: Unit;
  better: "higher" | "lower" | "neutral";
  formula?: string;
  finalAfterDays: number;
  lastFinalDate: string;
};

export type Catalog = {
  today: string;
  firstDataDate: string;
  lastDataDate: string;
  metrics: MetricDefinition[];
  dimensions: Dimension[];
  presets: { key: RangePreset; range: DateRange }[];
};

export type Entities = {
  campaigns: { id: string; name: string; channel: string; country: string; status: string }[];
  adsets: { id: string; campaign_id: string; name: string; status: string; daily_budget_usd: number }[];
  ads: { id: string; adset_id: string; name: string; creative_type: string; status: string; created_at: string }[];
};

export type MetricsQuery = {
  preset?: RangePreset;
  range?: DateRange;
  groupBy?: Dimension[];
  filters?: {
    channels?: string[];
    countries?: string[];
    campaignIds?: string[];
    adsetIds?: string[];
    adIds?: string[];
    creativeTypes?: string[];
    adStatus?: "active" | "paused";
  };
  orderBy?: { metric: MetricKey; direction: "asc" | "desc" };
  limit?: number;
  compare?: boolean;
};

export type PacingStatus = "on_pace" | "over" | "under" | "paused";

export type PacingFields = {
  daily_budget_usd: number;
  spend: number;
  avg_daily_spend: number;
  last_day_spend: number;
  /** avg_daily_spend ÷ daily_budget_usd; null without a budget. */
  pace: number | null;
  pacing: PacingStatus;
};

export type BudgetPacing = {
  range: DateRange;
  days: number;
  band: { under: number; over: number };
  adsets: ({ adset_id: string; adset_name: string; campaign_id: string; status: string } & PacingFields)[];
  campaigns: ({ campaign_id: string; campaign_name: string; channel: string; country: string } & PacingFields)[];
};

/** One message of an agent conversation, as the API expects it. */
export type ChatMessage = { role: "user" | "assistant"; text: string };

/** What `POST /agent/chat` streams, one JSON object per line. */
export type AgentEvent =
  | { type: "tool_call"; id: string; tool: string; label: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | ({ type: "export"; id: string; label: string } & AgentExport)
  | { type: "text_delta"; text: string }
  | { type: "note"; text: string }
  | { type: "answer"; text: string }
  | { type: "follow_ups"; questions: string[] }
  | { type: "error"; code: string; message: string; retryAfterSeconds?: number }
  | { type: "done"; model: string; steps: number; usage: { inputTokens: number; outputTokens: number } };

/** A file the agent was asked for; the dashboard's `/export` route renders it with these filters. */
export type AgentExport = {
  format: "pdf" | "xlsx" | "csv" | "json" | "md";
  preset?: string;
  from?: string;
  to?: string;
  channel?: string;
  country?: string;
  tables?: string[];
};

/** A model the agent can answer with (ZenMux id), as `GET /agent/models` lists it. */
export type AgentModel = { id: string; label: string; description: string };

export type AgentModels = { default: string; models: AgentModel[] };

/** A rule the team added on the Rules page; enabled rules go to the agent with every question. */
export type Rule = { id: string; text: string; enabled: boolean; createdAt: string; updatedAt: string };
