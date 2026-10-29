import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ANOMALY_DEFAULT_DAYS, ANOMALY_MAX_DAYS, ANOMALY_SETTINGS } from "../constants/anomalies.constant.js";
import { anomaliesController } from "../controllers/anomalies.controller.js";
import { AnomalyQuery, AnomalyReport } from "../schemas/anomalies.schema.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";

const anomaliesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = anomaliesController(app.services);
  app.addHook("onRequest", app.authenticate);

  const s = ANOMALY_SETTINGS;
  app.get(
    "/anomalies",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["anomalies"],
        summary: "Campaign anomaly monitor",
        description: [
          "Days on which a campaign's spend, CAC, D7 ROAS, CTR, CPC or conversions moved unusually far from its own recent history. Fixed rules, no model.",
          "",
          `- Each campaign × day × rule compares the day with the median of the same campaign's comparable days (${s.splitWeekends ? "weekdays with weekdays, weekends with weekends" : "all days"}) in the ${s.lookbackDays} days before it; at least ${s.minBaselineDays} are needed.`,
          `- A flag needs both a robust z-score of ${s.minScore}+ (MAD-based) and the rule's minimum relative change, plus the rule's volume floor. \`method\` lists every rule.`,
          "- CAC, conversions and D7 ROAS are only checked on days the team counts as final; the newest final day and days under 20 subscriptions are capped at low.",
          "- `coverage.skipped` counts the checks that couldn't run and why.",
          "",
          `Without \`from\`/\`to\`, the last ${ANOMALY_DEFAULT_DAYS} days. At most ${ANOMALY_MAX_DAYS} days, inside the data. An anomaly is a signal to investigate, not a cause.`,
        ].join("\n"),
        querystring: AnomalyQuery,
        response: {
          200: SuccessResponse(AnomalyReport, { title: "AnomalyReportResponse", message: "3 anomalies found" }),
          400: ErrorRef,
          401: ErrorRef,
        },
      },
    },
    async (req) => controller.list(req.query),
  );
};

export default anomaliesRoutes;
