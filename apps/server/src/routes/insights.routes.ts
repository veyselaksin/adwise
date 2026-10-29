import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { INSIGHTS_MAX, SNAPSHOT_TTL_MS } from "../constants/insights.constant.js";
import { insightsController } from "../controllers/insights.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import {
  Insight,
  InsightChanges,
  InsightDraft,
  InsightList,
  InsightListQuery,
  InsightParams,
  NewInsight,
  SnapshotBody,
} from "../schemas/insights.schema.js";

const ttlHours = SNAPSHOT_TTL_MS / 3_600_000;

const insightsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = insightsController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/insights",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["insights"],
        summary: "List saved insights",
        description: "The team's saved agent answers, newest first by default, without their evidence. `q` matches the title, the question or a campaign name; `from`/`to` filter by the day it was saved (UTC).",
        querystring: InsightListQuery,
        response: {
          200: SuccessResponse(InsightList, { title: "InsightListResponse", message: "Insights loaded" }),
          400: ErrorRef,
          401: ErrorRef,
        },
      },
    },
    async (req) => controller.list(req.query, req.user.sub),
  );

  app.post(
    "/insights/preview",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["insights"],
        summary: "Preview an insight before saving",
        description: `Verifies an answer's snapshot token and returns what saving it would store (suggested title, scope, caveats). Writes nothing. Tokens older than ${ttlHours} hours are refused (SNAPSHOT_EXPIRED); a changed one is INVALID_SNAPSHOT.`,
        body: SnapshotBody,
        response: {
          200: SuccessResponse(InsightDraft, { title: "InsightDraftResponse", message: "Insight ready to save" }),
          400: ErrorRef,
          401: ErrorRef,
        },
      },
    },
    async (req) => controller.preview(req.body),
  );

  app.post(
    "/insights",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["insights"],
        summary: "Save an agent answer as an insight",
        description: `Saves the answer, its question and every lookup's output from the signed snapshot, owned by the caller. The report is frozen: opening it later never re-runs anything. The same answer can be saved once (409 INSIGHT_EXISTS); at most ${INSIGHTS_MAX} insights.`,
        body: NewInsight,
        response: {
          200: SuccessResponse(Insight, { title: "InsightResponse", message: "Insight saved" }),
          400: ErrorRef,
          401: ErrorRef,
          409: ErrorRef,
        },
      },
    },
    async (req) => controller.create(req.body, req.user.sub),
  );

  app.get(
    "/insights/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["insights"],
        summary: "Open an insight",
        description: "The full report as it was saved, with its evidence. Any signed-in teammate can open it; `mine` says whether the caller may change it.",
        params: InsightParams,
        response: {
          200: SuccessResponse(Insight, { title: "InsightResponse", message: "Insight loaded" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.get(req.params.id, req.user.sub),
  );

  app.patch(
    "/insights/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["insights"],
        summary: "Rename an insight",
        description: "Changes the title only; the answer and evidence stay as saved. Only the account that saved it (403 FORBIDDEN otherwise).",
        params: InsightParams,
        body: InsightChanges,
        response: {
          200: SuccessResponse(Insight, { title: "InsightResponse", message: "Insight renamed" }),
          400: ErrorRef,
          401: ErrorRef,
          403: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.rename(req.params.id, req.body, req.user.sub),
  );

  app.delete(
    "/insights/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["insights"],
        summary: "Delete an insight",
        description: "Removes it for good and returns it; its link stops working. Only the account that saved it (403 FORBIDDEN otherwise).",
        params: InsightParams,
        response: {
          200: SuccessResponse(Insight, { title: "InsightResponse", message: "Insight deleted" }),
          400: ErrorRef,
          401: ErrorRef,
          403: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.remove(req.params.id, req.user.sub),
  );
};

export default insightsRoutes;
