import { randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import Type from "typebox";
import { safeEqual } from "../lib/crypto.js";
import { failure } from "../lib/response.js";
import { docsLoginCsp, renderDocsLogin } from "../views/docs-login.js";

declare module "fastify" {
  interface FastifyInstance {
    /** onRequest hook guarding every Swagger UI route. */
    docsGuard: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const DOCS_PREFIX = "/docs";
const LOGIN_PATH = `${DOCS_PREFIX}/login`;
const LOGOUT_PATH = `${DOCS_PREFIX}/logout`;
const COOKIE_NAME = "docs_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const LoginBody = Type.Object({
  username: Type.String({ maxLength: 256 }),
  password: Type.String({ maxLength: 256 }),
});

/**
 * Login page + signed session cookie for the API docs.
 * Browsers are redirected to /docs/login; scripts may still send an
 * `Authorization: Basic` header (no challenge, so no browser popup).
 */
export default fp(
  async (app) => {
    const { DOCS_USER, DOCS_PASSWORD, NODE_ENV } = app.config;
    const isValid = (user: string, pass: string) =>
      safeEqual(user, DOCS_USER) && safeEqual(pass, DOCS_PASSWORD);

    await app.register(cookie, { secret: app.config.COOKIE_SECRET });
    await app.register(formbody);

    const hasSession = (req: FastifyRequest) => {
      const raw = req.cookies[COOKIE_NAME];
      if (!raw) return false;
      const { valid, value } = req.unsignCookie(raw);
      return valid && Number(value) > Date.now();
    };

    const hasBasicAuth = (req: FastifyRequest) => {
      const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
      if (scheme?.toLowerCase() !== "basic" || !encoded) return false;
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      return sep > 0 && isValid(decoded.slice(0, sep), decoded.slice(sep + 1));
    };

    app.decorate("docsGuard", async (req: FastifyRequest, reply: FastifyReply) => {
      if (hasSession(req) || hasBasicAuth(req)) return;

      const wantsHtml = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
      if (wantsHtml) return reply.redirect(LOGIN_PATH);
      return reply.code(401).send(failure("UNAUTHORIZED", `Sign in at ${LOGIN_PATH} to view the docs`));
    });

    const sendLoginPage = (reply: FastifyReply, opts: { error?: string; username?: string } = {}) => {
      const nonce = randomBytes(16).toString("base64");
      return reply
        .header("cache-control", "no-store")
        .header("content-security-policy", docsLoginCsp(nonce))
        .type("text/html; charset=utf-8")
        .send(renderDocsLogin({ action: LOGIN_PATH, nonce, ...opts }));
    };

    app.get(LOGIN_PATH, { schema: { hide: true } }, async (req, reply) => {
      if (hasSession(req)) return reply.redirect(DOCS_PREFIX);
      return sendLoginPage(reply);
    });

    app.post(
      LOGIN_PATH,
      {
        schema: { hide: true, body: LoginBody },
        // Brute-force protection on top of the global limit.
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        attachValidation: true,
      },
      async (req, reply) => {
        const body = req.body as { username?: string; password?: string } | undefined;
        const username = body?.username ?? "";
        if (req.validationError || !isValid(username, body?.password ?? "")) {
          req.log.warn({ username }, "Failed docs sign-in");
          return sendLoginPage(reply.code(401), { username, error: "Invalid username or password." });
        }

        return reply
          .setCookie(COOKIE_NAME, String(Date.now() + SESSION_TTL_SECONDS * 1000), {
            path: DOCS_PREFIX,
            signed: true,
            httpOnly: true,
            sameSite: "strict",
            secure: NODE_ENV === "production",
            maxAge: SESSION_TTL_SECONDS,
          })
          .redirect(DOCS_PREFIX, 303);
      },
    );

    app.get(LOGOUT_PATH, { schema: { hide: true } }, async (_req, reply) =>
      reply.clearCookie(COOKIE_NAME, { path: DOCS_PREFIX }).redirect(LOGIN_PATH),
    );
  },
  { name: "docs-auth", dependencies: ["config"] },
);
