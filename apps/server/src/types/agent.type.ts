/** One message of a conversation as the dashboard keeps it. */
export type ChatMessage = { role: "user" | "assistant"; text: string };

/** Gemini's content format, kept verbatim between calls (thought signatures must round-trip). */
export type ModelPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
export type ModelContent = { role: "user" | "model"; parts: ModelPart[] };

export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

export type ModelUsage = { inputTokens: number; outputTokens: number };

export type ModelRequest = {
  system: string;
  contents: ModelContent[];
  tools: ToolDeclaration[];
  /** false forces a text answer (the last step). */
  allowTools: boolean;
  signal?: AbortSignal;
};

export type ModelResponse = { content: ModelContent; usage: ModelUsage };

/**
 * Anything that can answer a model request: Gemini in production, a script in
 * tests. Yields answer text as it's written; returns the whole response.
 */
export interface ModelClient {
  stream(request: ModelRequest): AsyncGenerator<string, ModelResponse>;
}

/** What the agent streams to the dashboard, one JSON object per line. */
export type AgentEvent =
  | { type: "tool_call"; id: string; tool: string; label: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "text_delta"; text: string }
  | { type: "note"; text: string }
  | { type: "answer"; text: string }
  | { type: "error"; code: string; message: string; retryAfterSeconds?: number }
  | { type: "done"; steps: number; usage: ModelUsage };
