import type { ModelPrice } from "../constants/pricing.constant.js";
import type { CostSource, ModelCallTelemetry } from "../types/telemetry.type.js";

/**
 * Pure calculations behind the observability numbers: percentiles, a model
 * call's cost, a run's token and cost totals, and chart buckets. Missing data
 * stays null; nothing here turns "not reported" into 0.
 */

/** Nearest-rank percentile (p in 0–100) of unsorted values; null for none. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;

/**
 * A call's cost: the provider's own figure when it sent one, else an estimate
 * from configured prices when both token counts are known, else null.
 */
export function callCost(
  usage: Pick<ModelCallTelemetry, "inputTokens" | "outputTokens" | "providerCost">,
  price: ModelPrice | undefined,
): { cost: number; source: "provider" | "estimate" } | null {
  if (usage.providerCost !== null) return { cost: usage.providerCost, source: "provider" };
  if (!price || usage.inputTokens === null || usage.outputTokens === null) return null;
  const tier = price.above && usage.inputTokens > price.above.promptTokens ? price.above : price;
  return {
    cost: (usage.inputTokens * tier.inputPerMTokens + usage.outputTokens * tier.outputPerMTokens) / 1_000_000,
    source: "estimate",
  };
}

export type CallTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  cost: number | null;
  costSource: "provider" | "estimate" | null;
  attempts: number | null;
};

export type RunTotals = {
  usageReportedCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Only when every call has a cost; one unpriced call makes the run's cost unknown. */
  cost: number | null;
  costSource: CostSource | null;
  retryCount: number | null;
};

/**
 * A run's totals from its model calls. Each call is counted once: retries
 * happen before a stream opens and bill nothing, so their attempts add to
 * retryCount only. Tokens are summed over the calls that reported them.
 */
export function runTotals(calls: CallTotals[]): RunTotals {
  const reported = calls.filter((c) => c.inputTokens !== null || c.outputTokens !== null);
  const sum = (pick: (c: CallTotals) => number | null) => {
    const values = reported.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
  };
  const inputTokens = sum((c) => c.inputTokens);
  const outputTokens = sum((c) => c.outputTokens);
  // The provider's total per call; derived from input + output only for a call that sent no total.
  const totalTokens = sum((c) => c.totalTokens ?? (c.inputTokens !== null && c.outputTokens !== null ? c.inputTokens + c.outputTokens : null));

  const priced = calls.every((c) => c.cost !== null) && calls.length > 0;
  const sources = new Set(calls.map((c) => c.costSource));
  const attempts = calls.map((c) => c.attempts).filter((a): a is number => a !== null);

  return {
    usageReportedCalls: reported.length,
    inputTokens,
    outputTokens,
    totalTokens,
    cost: priced ? calls.reduce((s, c) => s + c.cost!, 0) : null,
    costSource: !priced ? null : sources.size > 1 ? "mixed" : (calls[0]!.costSource as "provider" | "estimate"),
    retryCount: attempts.length === 0 ? null : attempts.reduce((s, a) => s + Math.max(0, a - 1), 0),
  };
}

/** Bucket starts covering [from, to), aligned to the bucket size (UTC). */
export function bucketStarts(fromMs: number, toMs: number, bucketMs: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(fromMs / bucketMs) * bucketMs; t < toMs; t += bucketMs) out.push(t);
  return out;
}

export const bucketOf = (ms: number, bucketMs: number) => Math.floor(ms / bucketMs) * bucketMs;

/** Change from `previous` to `current` as a ratio; null when either is missing or the base is 0. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}
