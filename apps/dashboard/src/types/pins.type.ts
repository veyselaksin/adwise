import type { MetricKey, MetricsResult } from "./metrics.type";

/** An agent `query_metrics` call pinned to the overview. */
export type Pin = { id: string; title: string; label: string; query: Record<string, unknown>; createdAt: string };

export type PinResult = { pin: Pin; metrics: MetricKey[]; result: MetricsResult; rowsOmitted: number };

export type PinActionResult = { error?: string; ok?: boolean };
