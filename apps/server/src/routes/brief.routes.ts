import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BRIEF_CAC_MOVE, BRIEF_COST_PER_TRIAL_MOVE, BRIEF_MIN_SUBSCRIPTIONS, BRIEF_MIN_TRIALS } from "../constants/brief.constant.js";
import { briefController } from "../controllers/brief.controller.js";
import { Brief } from "../schemas/brief.schema.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";

const pct = (n: number) => `${Math.round(n * 100)}%`;

const briefRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = briefController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/brief",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["metrics"],
        summary: "Morning brief",
        description: [
          "What changed yesterday, from fixed checks over the metric layer (no model), for every campaign:",
          `- each campaign's cost per trial yesterday against its last complete week, when it moved ${pct(BRIEF_COST_PER_TRIAL_MOVE)}+ on ${BRIEF_MIN_TRIALS}+ trials (yesterday's CAC isn't final)`,
          `- last week's CAC against the week before, when it moved ${pct(BRIEF_CAC_MOVE)}+ with ${BRIEF_MIN_SUBSCRIPTIONS}+ subscriptions in both weeks`,
          "- ad sets pacing outside the budget band over the last 7 days, and releases in the last 7 days",
          "",
          "Items needing a look come first; each campaign item carries the range to investigate.",
        ].join("\n"),
        response: {
          200: SuccessResponse(Brief, { title: "BriefResponse", message: "Brief ready" }),
          401: ErrorRef,
        },
      },
    },
    async () => controller.get(),
  );
};

export default briefRoutes;
