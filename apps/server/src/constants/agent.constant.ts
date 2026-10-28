/** ZenMux: one OpenAI-compatible endpoint in front of every model we offer. */
export const ZENMUX_API_URL = "https://zenmux.ai/api/v1";

/**
 * The models the team can pick in the agent panel, cheapest first. ids are
 * ZenMux slugs. `temperature` is left out where the provider only accepts its
 * default (OpenAI's reasoning models).
 */
export const AGENT_MODELS = [
  {
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    description: "Fast and inexpensive. The default.",
    temperature: 0.2,
  },
  {
    id: "z-ai/glm-5.2",
    label: "GLM 5.2",
    description: "Open-weight frontier model.",
    temperature: 0.2,
  },
  {
    id: "openai/gpt-6.1-sol",
    label: "GPT 6.1 Sol",
    description: "Closed frontier model. Slower and costs more.",
  },
] as const satisfies readonly { id: string; label: string; description: string; temperature?: number }[];

export const AGENT_MODEL_IDS = AGENT_MODELS.map((m) => m.id);

/** Model calls per question, tool rounds included. The last one is forced to answer. */
export const AGENT_MAX_STEPS = 6;

/** Recent messages sent verbatim; older ones shrink to the question and the answer's lead sentence. */
export const AGENT_RECENT_MESSAGES = 8;
export const AGENT_MAX_MESSAGES = 60;
export const AGENT_MAX_QUESTION_CHARS = 2000;
export const AGENT_MAX_ANSWER_CHARS = 8000;

/** Rows a tool hands the model; the totals still cover every row. */
export const AGENT_MAX_TOOL_ROWS = 50;

/** Questions per user per minute, on top of the global limit. Each one costs model calls. */
export const AGENT_RATE_LIMIT = 10;

/**
 * Retries for 429 and 5xx when opening a stream. A `Retry-After` longer than
 * `maxWaitMs` is reported instead of waited out.
 */
export const MODEL_RETRY = { attempts: 3, baseDelayMs: 1000, maxWaitMs: 15_000 };
/** Covers the whole streamed response; frontier models can think for a while. */
export const MODEL_TIMEOUT_MS = 120_000;
