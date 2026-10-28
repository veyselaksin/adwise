import type { AGENT_MODEL_IDS } from "../constants/agent.constant.js";

export type AgentModelId = (typeof AGENT_MODEL_IDS)[number];

/** One message of a conversation as the dashboard keeps it. */
export type ChatMessage = { role: "user" | "assistant"; text: string };

/** OpenAI's chat format, which ZenMux speaks for every model. */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
  /** Reasoning models (DeepSeek, GLM) expect their reasoning back while a question's tool loop runs. */
  reasoning_content?: string;
};

export type ModelMessage =
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDeclaration = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelUsage = { inputTokens: number; outputTokens: number };

export type ModelRequest = {
  model: AgentModelId;
  system: string;
  messages: ModelMessage[];
  tools: ToolDeclaration[];
  /** false forces a text answer (the last step). */
  allowTools: boolean;
  signal?: AbortSignal;
};

export type ModelResponse = { message: AssistantMessage; usage: ModelUsage };

/**
 * Anything that can answer a model request: ZenMux in production, a script in
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
  | { type: "done"; model: AgentModelId; steps: number; usage: ModelUsage };
