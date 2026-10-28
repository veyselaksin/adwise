import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { authController } from "../controllers/auth.controller.js";
import { LoginBody, Session } from "../schemas/auth.schema.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.schema.js";

const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = authController(app.services);

  app.post(
    "/auth/login",
    {
      // Tighter than the global limit: this is the one route open to guessing.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Sign in",
        description:
          "Exchanges the team's credentials (`APP_USER` / `APP_PASSWORD`) for a JWT valid for 12 hours. Limited to 10 attempts per minute per IP.",
        body: LoginBody,
        response: {
          200: SuccessResponse(Session, { title: "SessionResponse", message: "Signed in" }),
          400: ErrorRef,
          401: ErrorRef,
          429: ErrorRef,
        },
      },
    },
    async (req) => controller.login(req.body),
  );
};

export default authRoutes;
