import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { safeEqual } from "../lib/crypto.js";
import { AppError, success } from "../lib/response.js";
import { ErrorRef, SuccessResponse } from "../schemas/common.js";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

const Session = Type.Object({
  token: Type.String({ description: "JWT to send as `Authorization: Bearer <token>`", examples: ["eyJhbGciOi…"] }),
  expiresIn: Type.Integer({ description: "Seconds until the token expires", examples: [TOKEN_TTL_SECONDS] }),
  user: Type.String({ examples: ["marketing"] }),
});

const auth: FastifyPluginAsyncTypebox = async (app) => {
  const { APP_USER, APP_PASSWORD } = app.config;

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
        body: Type.Object({
          username: Type.String({ minLength: 1, maxLength: 256, examples: ["marketing"] }),
          password: Type.String({ minLength: 1, maxLength: 256, examples: ["••••••••"] }),
        }),
        response: {
          200: SuccessResponse(Session, { title: "SessionResponse", message: "Signed in" }),
          400: ErrorRef,
          401: ErrorRef,
          429: ErrorRef,
        },
      },
    },
    async (req) => {
      const { username, password } = req.body;
      // Evaluate both so a wrong username takes as long as a wrong password.
      const userOk = safeEqual(username, APP_USER);
      const passOk = safeEqual(password, APP_PASSWORD);
      if (!userOk || !passOk) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Wrong username or password");
      }
      const token = await app.jwt.sign({ sub: username }, { expiresIn: TOKEN_TTL_SECONDS });
      return success({ token, expiresIn: TOKEN_TTL_SECONDS, user: username }, "Signed in");
    },
  );
};

export default auth;
