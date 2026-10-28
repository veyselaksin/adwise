import type { QueryMetricsArgs } from "../services/agent.tools.js";
import type { MetricKey, MetricsResponse } from "./metrics.type.js";

/** An agent lookup pinned to the overview: the query_metrics call itself, not its numbers. */
export type Pin = {
  id: string;
  /** The question it answered, or the team's own name for it. */
  title: string;
  /** The step-list label of the call, e.g. "cac by channel · last 7 days". */
  label: string;
  query: QueryMetricsArgs;
  createdAt: string;
};

/** A pin re-run now: same query, period resolved again. */
export type PinResult = {
  pin: Pin;
  /** The metrics the call asked for (all of them when it named none). */
  metrics: MetricKey[];
  result: MetricsResponse;
  /** Rows beyond PIN_MAX_ROWS, left out of `result.rows`. */
  rowsOmitted: number;
};
