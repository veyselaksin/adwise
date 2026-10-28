import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { budgetsController } from "../controllers/budgets.controller.js";
import { BudgetPacing, PacingQuery } from "../schemas/budgets.schema.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";

const budgetsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = budgetsController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/budgets/pacing",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["budgets"],
        summary: "Budget pacing",
        description: [
          "Each ad set's average daily spend over the last `days` full days (ending yesterday) against its daily budget, plus the same summed per campaign.",
          "",
          "- The data only has each ad set's **current** budget, and budgets have changed over time. So pacing always uses a recent window and ignores the dashboard's date range; comparing older spend with today's budget would show false over- or underspend.",
          "- Paused ad sets are reported as `paused` and never flagged.",
          "- Spend is final the day it loads, so no day in the window is provisional.",
        ].join("\n"),
        querystring: PacingQuery,
        response: {
          200: SuccessResponse(BudgetPacing, { title: "BudgetPacingResponse", message: "Budget pacing loaded" }),
          400: ErrorRef,
          401: ErrorRef,
        },
      },
    },
    async (req) => controller.pacing(req.query),
  );
};

export default budgetsRoutes;
