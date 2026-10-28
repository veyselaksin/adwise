import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AppError, success } from "../lib/response.js";
import { previousPeriod, RANGE_PRESETS, resolvePreset } from "../metrics/dates.js";
import { METRIC_KEYS, METRICS } from "../metrics/definitions.js";
import { DIMENSIONS } from "../metrics/query.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.js";
import { Catalog, EntitiesSchema, MetricsQueryBody, MetricsResult } from "../schemas/metrics.js";

const protectedRoute = { security: [{ bearerAuth: [] }] };

const metrics: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/metrics/catalog",
    {
      schema: {
        ...protectedRoute,
        tags: ["metrics"],
        summary: "Metric definitions and calendar",
        description:
          "The glossary's metrics with their formulas and how long each takes to become final, the data's date span, and the team's named periods resolved to dates. \"Today\" is the day after the last day in the data.",
        response: {
          200: SuccessResponse(Catalog, { title: "CatalogResponse", message: "Catalog loaded" }),
          401: ErrorRef,
        },
      },
    },
    async () => {
      const m = app.metrics;
      return success(
        {
          today: m.today,
          firstDataDate: m.firstDataDate,
          lastDataDate: m.lastDataDate,
          metrics: METRIC_KEYS.map((key) => {
            const { formula, ...def } = METRICS[key];
            return {
              ...def,
              ...(formula && { formula: `${formula.numerator} ÷ ${formula.denominator}` }),
              lastFinalDate: m.lastFinalDate(key),
            };
          }),
          dimensions: [...DIMENSIONS],
          presets: RANGE_PRESETS.map((key) => ({ key, range: resolvePreset(key, m.today) })),
        },
        "Catalog loaded",
      );
    },
  );

  app.post(
    "/metrics/query",
    {
      schema: {
        ...protectedRoute,
        tags: ["metrics"],
        summary: "Query metrics",
        description: [
          "Sums the daily ad data over a date range, split by any dimensions, and derives every glossary metric from the sums (never by averaging daily ratios).",
          "",
          "- Give either `preset` or `range`.",
          "- `totals` is the blended number across all rows; compare countries/channels in `rows` first.",
          "- Each row lists its `provisional` metrics: values that include install days too recent to be final, such as CAC for days less than 4 days old. Show them as not final.",
          "- It's a POST because the query has nested filters; it never changes data.",
        ].join("\n"),
        body: MetricsQueryBody,
        response: {
          200: SuccessResponse(MetricsResult, { title: "MetricsResponse", message: "Metrics loaded" }),
          400: ErrorRef,
          401: ErrorRef,
        },
      },
    },
    async (req) => {
      const { preset, range: explicit, compare, ...rest } = req.body;
      const range = preset ? resolvePreset(preset, app.metrics.today) : explicit;
      if (!range) throw new AppError(400, "MISSING_RANGE", "Give either `preset` or `range`");

      const result = app.metrics.query({ ...rest, range });
      const previous = compare
        ? (() => {
            const prevRange = previousPeriod(range);
            return { range: prevRange, totals: app.metrics.query({ ...rest, range: prevRange }).totals };
          })()
        : undefined;
      return success({ ...result, ...(previous && { previous }) }, "Metrics loaded");
    },
  );

  app.get(
    "/entities",
    {
      schema: {
        ...protectedRoute,
        tags: ["metrics"],
        summary: "Campaigns, ad sets and ads",
        description:
          "Every campaign, ad set (with its daily budget) and ad (with creative type and current status), for filter lists and labels. Ad names repeat across ad sets, so show an ad with its ad set.",
        response: {
          200: SuccessResponse(EntitiesSchema, { title: "EntitiesResponse", message: "Entities loaded" }),
          401: ErrorRef,
        },
      },
    },
    async () => success(app.metrics.entities(), "Entities loaded"),
  );
};

export default metrics;
