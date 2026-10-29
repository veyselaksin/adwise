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
  /** The answer and its evidence, signed by the server, for saving as an insight. */
  | { type: "snapshot"; token: string }
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

export type AgentStep = {
  id: string;
  label: string;
  status: "running" | "ok" | "failed";
  summary?: string;
  /** The call itself, so a `query_metrics` lookup can be pinned. Missing on turns saved before pins existed. */
  tool?: string;
  args?: Record<string, unknown>;
};

/** A file the agent made: a link to the dashboard's own export, so it matches the overview. */
export type AgentDownload = { id: string; label: string; format: AgentExport["format"]; href: string };

export type AgentTurn = {
  id: string;
  question: string;
  steps: AgentStep[];
  notes: string[];
  downloads: AgentDownload[];
  /** Text still being written; it becomes the answer, or a note if a lookup follows. */
  draft: string;
  answer?: string;
  /** Suggested next questions, sent after the answer. */
  followUps?: string[];
  /** Signed snapshot of a complete answer; saving it as an insight needs it. */
  snapshot?: string;
  error?: { code: string; message: string };
  usage?: { model: string; steps: number; tokens: number };
  status: "streaming" | "done" | "stopped";
};
