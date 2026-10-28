import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { releasesController } from "../controllers/releases.controller.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";
import { Release, ReleasesQuery } from "../schemas/releases.schema.js";

const releasesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = releasesController(app.services);
  app.addHook("onRequest", app.authenticate);

  app.get(
    "/releases",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ["releases"],
        summary: "App releases from the build logs",
        description:
          "iOS and Android releases shipped between `from` and `to` (by release day, both optional), oldest first, with every commit. The ad data has no iOS/Android split, so releases line up with metrics by date only.",
        querystring: ReleasesQuery,
        response: {
          200: SuccessResponse(Type.Array(Release), { title: "ReleaseList", message: "Releases loaded" }),
          400: ErrorRef,
          401: ErrorRef,
        },
      },
    },
    async (req) => controller.list(req.query),
  );
};

export default releasesRoutes;
