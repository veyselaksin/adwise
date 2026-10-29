import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { observabilityController } from "../controllers/observability.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import {
  LogPage,
  LogQuery,
  RangeQuery,
  RunDetail,
  RunList,
  RunListQuery,
  RunParams,
  RuntimeSnapshot,
  Summary,
  Timeseries,
} from "../schemas/observability.schema.js";

/**
 * Reading these pages shouldn't flood the server log with its own traffic:
 * request lines for these routes only print at warn and above.
 */
const quiet = { logLevel: "warn" } as const;

const observabilityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = observabilityController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/observability/summary",
    {
      ...quiet,
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["observability"],
        summary: "Agent run KPIs",
        description: [
          "Runs, success rate, durations, tokens and cost over a window ending now, from the persisted telemetry, plus per-tool and per-model call stats.",
          "",
          "- **Success rate** = success ÷ (success + failure + timeout + interrupted). Cancelled runs (the user closed the panel) don't count either way.",
          "- **Durations** cover successful runs. P95 is the nearest-rank percentile and is null under `p95MinRuns` runs.",
          "- **Tokens** are provider-reported only; runs that reported none are counted in `runsWithoutUsage`, not as 0.",
          "- **Cost** sums runs whose every model call has a cost (ZenMux's reported `usage.cost`, else an estimate from `constants/pricing.constant.ts`).",
          "- `previous` is the window just before, given only when it has enough finished runs to compare.",
        ].join("\n"),
        querystring: RangeQuery,
        response: { 200: SuccessResponse(Summary, { title: "ObservabilitySummaryResponse", message: "Summary loaded" }), 400: ErrorRef, 401: ErrorRef },
      },
    },
    async (req) => controller.summary(req.query),
  );

  app.get(
    "/observability/timeseries",
    {
      ...quiet,
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["observability"],
        summary: "Agent runs over time",
        description:
          "Runs per bucket (5 min for 1h, 1 h for 24h, 6 h for 7d, 1 day for 30d, UTC-aligned) with outcomes, durations, model time, tokens and cost. Empty buckets have 0 runs and null averages; nothing is filled in.",
        querystring: RangeQuery,
        response: { 200: SuccessResponse(Timeseries, { title: "ObservabilityTimeseriesResponse", message: "Time series loaded" }), 400: ErrorRef, 401: ErrorRef },
      },
    },
    async (req) => controller.timeseries(req.query),
  );

  app.get(
    "/observability/runs",
    {
      ...quiet,
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["observability"],
        summary: "Search agent runs",
        description: "Persisted runs in the window, filtered and sorted, one page at a time (at most 100). `q` matches the start of a run id or trace id.",
        querystring: RunListQuery,
        response: { 200: SuccessResponse(RunList, { title: "RunListResponse", message: "42 runs found" }), 400: ErrorRef, 401: ErrorRef },
      },
    },
    async (req) => controller.runs(req.query),
  );

  app.get(
    "/observability/runs/:id",
    {
      ...quiet,
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["observability"],
        summary: "One run's trace",
        description:
          "The run, its spans (model calls, tool calls, stages) in start order and the log lines that name it. Spans hold timings, statuses, token usage and safe metadata only: never prompts, answers or query results. `partial` says why a trace may be incomplete.",
        params: RunParams,
        response: { 200: SuccessResponse(RunDetail, { title: "RunDetailResponse", message: "Run loaded" }), 400: ErrorRef, 401: ErrorRef, 404: ErrorRef },
      },
    },
    async (req) => controller.run(req.params.id),
  );

  app.get(
    "/observability/logs",
    {
      ...quiet,
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["observability"],
        summary: "Search server logs",
        description:
          "Persisted log lines, newest first, a page at a time (keyset paging with `before`). Kept: every warn/error and info lines about application events (finished runs, retention). Values are redacted centrally before they are stored.",
        querystring: LogQuery,
        response: { 200: SuccessResponse(LogPage, { title: "LogPageResponse", message: "Logs loaded" }), 400: ErrorRef, 401: ErrorRef },
      },
    },
    async (req) => controller.logs(req.query),
  );

  app.get(
    "/observability/runtime",
    {
      ...quiet,
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["observability"],
        summary: "This process's runtime",
        description:
          "Live memory (process.memoryUsage, bytes), uptime and versions; CPU and event-loop delay from the last 10-second sample; the recent samples kept in memory; and connectivity checks for the case database and the telemetry store. Covers this one process only: no host, container or fleet metrics.",
        response: { 200: SuccessResponse(RuntimeSnapshot, { title: "RuntimeSnapshotResponse", message: "Runtime measured" }), 401: ErrorRef },
      },
    },
    async () => controller.runtime(),
  );
};

export default observabilityRoutes;
