import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { CONCEPTS_RATE_LIMIT, CREATIVE_MAX_DAYS, IMAGE_PROMPT_SUFFIX, IMAGE_RATE_LIMIT } from "../constants/creatives.constant.js";
import { creativesController } from "../controllers/creatives.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import {
  BriefSuggestBody,
  BriefSuggestResult,
  ConceptsBody,
  ConceptsResult,
  Context,
  ContextQuery,
  Creative,
  CreativeChanges,
  CreativeList,
  CreativeListQuery,
  CreativeParams,
  GenerateBody,
  GenerateResult,
  ImageQuery,
  StudioConfig,
} from "../schemas/creatives.schema.js";

const creativesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = creativesController(app.services, app.config.AGENT_MODEL);
  app.addHook("onRequest", app.authenticate);
  const security = [{ bearerAuth: [] }];
  const tags = ["creatives"];

  app.get(
    "/creatives/config",
    {
      schema: {
        security,
        tags,
        summary: "Creative studio settings",
        description: "Whether concept and image generation are configured, the image model and its aspect ratios, today's usage against the daily limit, and why cost isn't shown. Never includes credentials.",
        response: { 200: SuccessResponse(StudioConfig, { title: "StudioConfigResponse", message: "Studio settings loaded" }), 401: ErrorRef },
      },
    },
    async () => controller.config(),
  );

  app.get(
    "/creatives/context",
    {
      schema: {
        security,
        tags,
        summary: "Measured performance for a campaign, ad set or ad",
        description: `The selected entity's metrics for \`from\`–\`to\` (at most ${CREATIVE_MAX_DAYS} days) through the metric layer, against the same number of days before when that period is in the data. Each metric says whether it's observed (summed from the warehouse) or calculated (a ratio of sums); null means it can't be computed. \`unavailable\` lists what creative work usually asks for but this data doesn't hold. \`status: insufficient\` means concepts will be exploratory. No model call.`,
        querystring: ContextQuery,
        response: {
          200: SuccessResponse(Context, { title: "CreativeContextResponse", message: "Performance context loaded" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.context(req.query),
  );

  app.post(
    "/creatives/brief-suggestions",
    {
      config: { rateLimit: { max: CONCEPTS_RATE_LIMIT, timeWindow: "1 minute" } },
      schema: {
        security,
        tags,
        summary: "Suggest the empty brief fields",
        description: [
          "Asks the text model to propose the brief fields the user left empty, from the selection's names, channel, country and (with enough delivery) measured performance. Fields the user filled are never suggested over. Each suggestion says whether it follows from the data (`basis: data`) or is an assumption; the data has no audience demographics, product details or brand rules.",
          "",
          "Suggestions carry no money or percentage figures (sentences with one are removed, counted in `removed`). Same validation and model error codes as `/creatives/concepts`; `400 BRIEF_COMPLETE` when every field is already filled. Nothing is saved.",
        ].join("\n"),
        body: BriefSuggestBody,
        response: {
          200: SuccessResponse(BriefSuggestResult, { title: "BriefSuggestResponse", message: "Brief suggestions generated" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
          422: ErrorRef,
          429: ErrorRef,
          502: ErrorRef,
          503: ErrorRef,
        },
      },
    },
    async (req, reply) => controller.brief(req.body, reply),
  );

  app.post(
    "/creatives/concepts",
    {
      config: { rateLimit: { max: CONCEPTS_RATE_LIMIT, timeWindow: "1 minute" } },
      schema: {
        security,
        tags,
        summary: "Write creative concepts",
        description: [
          "Asks the text model for 2–3 concepts, each with copy, an image prompt, the evidence it builds on, its assumptions and a test hypothesis. With a `source` that has enough delivery, the concepts are performance-informed; otherwise (no source, or too little data) they're exploratory and carry no evidence.",
          "",
          "The reply is validated against a schema (one retry when malformed, then `502 MALFORMED_RESPONSE`). Evidence citing unknown ids and statements with money or percentage figures not in the measured data are removed (`removed` counts them). Nothing is saved and no image is requested.",
          "",
          "Model failures keep their codes: `429 RATE_LIMITED`, `503 QUOTA_EXHAUSTED` / `MODEL_UNAVAILABLE`, `502 MODEL_ERROR`, `422 MODEL_BLOCKED`. `503 AGENT_DISABLED` without ZENMUX_API_KEY.",
        ].join("\n"),
        body: ConceptsBody,
        response: {
          200: SuccessResponse(ConceptsResult, { title: "ConceptsResponse", message: "Concepts generated from measured performance" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
          422: ErrorRef,
          429: ErrorRef,
          502: ErrorRef,
          503: ErrorRef,
        },
      },
    },
    async (req, reply) => controller.concepts(req.body, reply),
  );

  app.post(
    "/creatives",
    {
      config: { rateLimit: { max: IMAGE_RATE_LIMIT, timeWindow: "1 minute" } },
      schema: {
        security,
        tags,
        summary: "Generate 1–3 images and save each as a creative",
        description: [
          `Sends the approved image prompt (plus "${IMAGE_PROMPT_SUFFIX}") to the image provider, stores the images on the server and saves one creative per image with its copy, concept and a snapshot of the source's metrics. \`count\` (1–3, default 1) images are generated side by side: **each image is a separate paid request.** It takes ~30–45 s and keeps running if the client disconnects, so no image is lost. If some images fail and others succeed, the response is \`200\` with the failed ones marked \`failed\`; if all fail, the first failure's error is returned.`,
          "",
          "Cost controls: the same `idempotencyKey` returns the saved creatives (no new request); one request per account at a time (`409 GENERATION_IN_PROGRESS`); a team-wide cap on images in flight (`429 TOO_MANY_GENERATIONS`) and a daily limit counted in images (`429 DAILY_LIMIT_REACHED` when fewer than `count` are left). Only a provider 429 is retried automatically; anything that may have been billed is reported for the user to retry deliberately.",
          "",
          "Provider failures: `429 IMAGE_RATE_LIMITED`, `503 IMAGE_UNAVAILABLE` / `IMAGE_QUOTA_EXHAUSTED`, `504 IMAGE_TIMEOUT`, `422 IMAGE_REJECTED` / `IMAGE_BLOCKED`, `502 IMAGE_BAD_OUTPUT`. A failed generation stays in the library with `status: failed`. `503 IMAGE_DISABLED` without an image key.",
        ].join("\n"),
        body: GenerateBody,
        response: {
          200: SuccessResponse(GenerateResult, { title: "GenerateResponse", message: "Image generated" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
          409: ErrorRef,
          422: ErrorRef,
          429: ErrorRef,
          502: ErrorRef,
          503: ErrorRef,
          504: ErrorRef,
        },
      },
    },
    async (req) => controller.generate(req.body, req.user.sub, req.id),
  );

  app.get(
    "/creatives",
    {
      schema: {
        security,
        tags,
        summary: "List your creatives",
        description: "The caller's creatives, newest first, paged. `q` matches the title, headline or campaign; filter by `status`, `basis` (data-informed or exploratory) or `campaignId`.",
        querystring: CreativeListQuery,
        response: { 200: SuccessResponse(CreativeList, { title: "CreativeListResponse", message: "Creatives loaded" }), 400: ErrorRef, 401: ErrorRef },
      },
    },
    async (req) => controller.list(req.query, req.user.sub),
  );

  app.get(
    "/creatives/:id",
    {
      schema: {
        security,
        tags,
        summary: "Open a creative",
        description: "The saved creative as generated: concept, copy, prompt, metrics snapshot, provider and model, timings and cost status. Another account's creative is `404`.",
        params: CreativeParams,
        response: { 200: SuccessResponse(Creative, { title: "CreativeResponse", message: "Creative loaded" }), 400: ErrorRef, 401: ErrorRef, 404: ErrorRef },
      },
    },
    async (req) => controller.get(req.params.id, req.user.sub),
  );

  app.get(
    "/creatives/:id/image",
    {
      schema: {
        security,
        tags,
        summary: "Download a creative's image",
        description: "The stored image bytes (PNG, JPEG or WebP), private and uncached. `download=true` sends it as an attachment. Owner only (`404` otherwise).",
        params: CreativeParams,
        querystring: ImageQuery,
        produces: ["image/png", "image/jpeg", "image/webp"],
        response: { 200: Type.Unsafe({ type: "string", format: "binary" }), 400: ErrorRef, 401: ErrorRef, 404: ErrorRef },
      },
    },
    async (req, reply) => controller.image(req.params.id, req.query.download ?? false, req.user.sub, reply),
  );

  app.patch(
    "/creatives/:id",
    {
      schema: {
        security,
        tags,
        summary: "Edit a creative's title or copy",
        description: "Changes the title and ad copy only. The image, prompt and evidence stay as generated; a new image is a new `POST /creatives` with `parentId`.",
        params: CreativeParams,
        body: CreativeChanges,
        response: { 200: SuccessResponse(Creative, { title: "CreativeResponse", message: "Creative updated" }), 400: ErrorRef, 401: ErrorRef, 404: ErrorRef },
      },
    },
    async (req) => controller.edit(req.params.id, req.body, req.user.sub),
  );

  app.delete(
    "/creatives/:id",
    {
      schema: {
        security,
        tags,
        summary: "Delete a creative",
        description: "Removes the record and its image file for good. Not while it's generating (`409`).",
        params: CreativeParams,
        response: { 200: SuccessResponse(Creative, { title: "CreativeResponse", message: "Creative deleted" }), 400: ErrorRef, 401: ErrorRef, 404: ErrorRef, 409: ErrorRef },
      },
    },
    async (req) => controller.remove(req.params.id, req.user.sub),
  );
};

export default creativesRoutes;
