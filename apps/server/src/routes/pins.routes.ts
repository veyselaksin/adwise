import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { PIN_MAX_ROWS, PINS_MAX } from "../constants/pins.constant.js";
import { pinsController } from "../controllers/pins.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import { NewPin, Pin, PinList, PinParams, PinResult } from "../schemas/pins.schema.js";

const pinsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = pinsController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/pins",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["pins"],
        summary: "List pinned tiles",
        description: "Every tile pinned from an agent answer, oldest first. Each holds the agent's query, not its numbers.",
        response: { 200: SuccessResponse(PinList, { title: "PinListResponse", message: "Pinned tiles loaded" }), 401: ErrorRef },
      },
    },
    async () => controller.list(),
  );

  app.post(
    "/pins",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["pins"],
        summary: "Pin an agent lookup to the overview",
        description: `Saves a query_metrics call (validated like a tool call; it needs a preset or from/to) as a tile. At most ${PINS_MAX} tiles.`,
        body: NewPin,
        response: {
          200: SuccessResponse(Pin, { title: "PinResponse", message: "Tile pinned" }),
          400: ErrorRef,
          401: ErrorRef,
          409: ErrorRef,
        },
      },
    },
    async (req) => controller.add(req.body),
  );

  app.get(
    "/pins/:id/result",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["pins"],
        summary: "Run a pinned tile",
        description: `Re-runs the pinned call on the metric layer now (no model call); named periods resolve to today's dates. At most ${PIN_MAX_ROWS} rows; totals cover all of them.`,
        params: PinParams,
        response: {
          200: SuccessResponse(PinResult, { title: "PinResultResponse", message: "Tile loaded" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.result(req.params.id),
  );

  app.delete(
    "/pins/:id",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["pins"],
        summary: "Remove a pinned tile",
        description: "Removes the tile for good and returns it.",
        params: PinParams,
        response: {
          200: SuccessResponse(Pin, { title: "PinResponse", message: "Tile removed" }),
          400: ErrorRef,
          401: ErrorRef,
          404: ErrorRef,
        },
      },
    },
    async (req) => controller.remove(req.params.id),
  );
};

export default pinsRoutes;
