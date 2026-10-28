import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { testEnv } from "./helpers.js";

const env = testEnv();

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

const form = (fields: Record<string, string>) => ({
  "content-type": "application/x-www-form-urlencoded",
  payload: new URLSearchParams(fields).toString(),
});

describe("server", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    app = await buildApp(env);
    await app.ready();
  });
  after(() => app.close());

  const login = (username: string, password: string) => {
    const { payload, ...headers } = form({ username, password });
    return app.inject({ method: "POST", url: "/docs/login", headers, payload });
  };

  it("GET /health is public and returns the success envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body), ["success", "message", "data"]);
    assert.equal(body.success, true);
    assert.equal(body.message, "Service is healthy");
    assert.equal(body.data.status, "ok");
    assert.equal(typeof body.data.uptime, "number");
    assert.match(body.data.version, /^v\d+\.\d+\.\d+$/);
  });

  it("unknown routes return the failure envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), {
      success: false,
      message: "Route GET /nope not found",
      error: { code: "NOT_FOUND" },
    });
  });

  describe("docs auth", () => {
    it("redirects browsers to the login page", async () => {
      const res = await app.inject({ method: "GET", url: "/docs", headers: { accept: "text/html" } });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, "/docs/login");
    });

    for (const url of ["/docs/json", "/docs/yaml"]) {
      it(`${url} returns 401 JSON without a session and no Basic challenge`, async () => {
        const res = await app.inject({ method: "GET", url });
        assert.equal(res.statusCode, 401);
        const body = res.json();
        assert.equal(body.success, false);
        assert.equal(body.error.code, "UNAUTHORIZED");
        assert.equal(res.headers["www-authenticate"], undefined);
      });
    }

    it("serves the login page", async () => {
      const res = await app.inject({ method: "GET", url: "/docs/login" });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /<form method="post" action="\/docs\/login">/);
      assert.match(res.body, /images\.unsplash\.com/);
      assert.match(res.body, /data-theme-option="dark"/);

      const csp = String(res.headers["content-security-policy"]);
      const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
      assert.ok(nonce, "CSP carries a script nonce");
      assert.match(csp, /img-src https:\/\/images\.unsplash\.com/);
      assert.ok(res.body.includes(`<script nonce="${nonce}">`), "inline scripts use the CSP nonce");
    });

    it("rejects wrong credentials and escapes the echoed username", async () => {
      const res = await login("<script>", "wrong");
      assert.equal(res.statusCode, 401);
      assert.match(res.body, /Invalid username or password/);
      assert.doesNotMatch(res.body, /<script>/);
      assert.equal(res.cookies.length, 0);
    });

    it("signs in, then serves the UI and spec with the session cookie", async () => {
      const res = await login("docs", "docs-password");
      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, "/docs");

      const session = res.cookies.find((c) => c.name === "docs_session");
      assert.ok(session);
      assert.equal(session.httpOnly, true);
      assert.equal(session.sameSite, "Strict");

      const cookies = { docs_session: session.value };
      const ui = await app.inject({ method: "GET", url: "/docs", cookies });
      assert.equal(ui.statusCode, 200);
      assert.match(ui.body, /swagger-ui/);

      const asset = await app.inject({ method: "GET", url: "/docs/static/swagger-initializer.js", cookies });
      assert.equal(asset.statusCode, 200);

      assert.match(ui.body, /theme\/overrides\.css/);
      const css = await app.inject({ method: "GET", url: "/docs/static/theme/overrides.css", cookies });
      assert.equal(css.statusCode, 200);
      const cssAnon = await app.inject({ method: "GET", url: "/docs/static/theme/overrides.css" });
      assert.equal(cssAnon.statusCode, 401);

      const spec = await app.inject({ method: "GET", url: "/docs/json", cookies });
      assert.equal(spec.statusCode, 200);
      assert.equal(spec.json().info.title, "ADWISE API");
    });

    it("rejects a tampered session cookie", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/docs/json",
        cookies: { docs_session: `${Date.now() + 60_000}.forged` },
      });
      assert.equal(res.statusCode, 401);
    });

    it("sign out clears the session cookie", async () => {
      const res = await app.inject({ method: "GET", url: "/docs/logout" });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, "/docs/login");
      const cleared = res.cookies.find((c) => c.name === "docs_session");
      assert.ok(cleared);
      assert.equal(cleared.value, "");
    });

    it("still accepts Basic auth for scripts", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/docs/json",
        headers: { authorization: basic("docs", "docs-password") },
      });
      assert.equal(res.statusCode, 200);
      const spec = res.json();
      assert.equal(spec.openapi, "3.1.0");
      assert.ok(spec.paths["/health"]);
      assert.ok(spec.components.securitySchemes.bearerAuth);
      assert.equal(spec.paths["/docs/login"], undefined, "auth routes are hidden from the spec");
    });
  });

  it("rate-limited requests return the failure envelope", async () => {
    // Fresh instance so the login attempts above don't count toward the limit.
    const limited = await buildApp(env);
    try {
      let res;
      for (let i = 0; i < 11; i++) {
        const { payload, ...headers } = form({ username: "docs", password: "wrong" });
        res = await limited.inject({ method: "POST", url: "/docs/login", headers, payload });
      }
      assert.equal(res?.statusCode, 429);
      const body = res?.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, "RATE_LIMITED");
      assert.match(body.message, /Too many requests/);
    } finally {
      await limited.close();
    }
  });

  it("rejects a weak configuration at startup", () => {
    assert.throws(() => loadEnv({ JWT_SECRET: "short", DOCS_USER: "", DOCS_PASSWORD: "x" }), /JWT_SECRET/);
  });
});
