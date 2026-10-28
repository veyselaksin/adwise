import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { entitiesController } from "../controllers/entities.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import { Entities } from "../schemas/entities.schema.js";

const entitiesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = entitiesController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/entities",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["metrics"],
        summary: "Campaigns, ad sets and ads",
        description:
          "Every campaign, ad set (with its daily budget) and ad (with creative type and current status), for filter lists and labels. Ad names repeat across ad sets, so show an ad with its ad set.",
        response: {
          200: SuccessResponse(Entities, { title: "EntitiesResponse", message: "Entities loaded" }),
          401: ErrorRef,
        },
      },
    },
    async () => controller.list(),
  );
};

export default entitiesRoutes;
