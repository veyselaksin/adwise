import type { AgentModelId } from "../types/agent.type.js";

/**
 * Fallback prices for estimating a model call's cost, USD per million tokens.
 *
 * ZenMux reports each call's actual cost in the stream's `usage.cost`, and that
 * figure is preferred. These rates are used only when a call reports tokens but
 * no cost. Update them from the source below when ZenMux changes its prices.
 *
 * Source: https://zenmux.ai/api/v1/models (`pricings.prompt` / `pricings.completion`),
 * read 2026-10-29.
 * - DeepSeek V4.1 Flash lists six unconditioned tiers ($0.075 or $0.15 input,
 *   $0.30 or $0.60 output). A real call on 2026-10-29 was billed at the higher
 *   pair, so that pair is used: an estimate may run high, never low.
 * - GPT 6.1 Sol doubles its prices above 272k prompt tokens.
 */
export const MODEL_PRICING: Record<AgentModelId, ModelPrice> = {
  "deepseek/deepseek-v4.1-flash": { inputPerMTokens: 0.15, outputPerMTokens: 0.6 },
  "z-ai/glm-5.2": { inputPerMTokens: 1.4, outputPerMTokens: 4.4 },
  "openai/gpt-6.1-sol": {
    inputPerMTokens: 2,
    outputPerMTokens: 10,
    above: { promptTokens: 272_000, inputPerMTokens: 4, outputPerMTokens: 15 },
  },
};

export const PRICING_SOURCE = { url: "https://zenmux.ai/api/v1/models", readOn: "2026-10-29", currency: "USD" } as const;

export type ModelPrice = {
  inputPerMTokens: number;
  outputPerMTokens: number;
  /** A higher tier for long prompts. */
  above?: { promptTokens: number; inputPerMTokens: number; outputPerMTokens: number };
};
