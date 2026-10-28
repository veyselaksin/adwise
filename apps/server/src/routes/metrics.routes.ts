import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { metricsController } from "../controllers/metrics.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import { Catalog, MetricsQueryBody, MetricsResult } from "../schemas/metrics.schema.js";

const metricsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = metricsController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/metrics/catalog",
    {
      schema: {
        security: [{ bearerAuth: [] }],
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
    async () => controller.catalog(),
  );

  app.post(
    "/metrics/query",
    {
      schema: {
        security: [{ bearerAuth: [] }],
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
    async (req) => controller.query(req.body),
  );
};

export default metricsRoutes;
