import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  DOCS_USER: "docs",
  DOCS_PASSWORD: "docs-password",
  DB_PATH: "unused-in-these-tests.db",
});

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("api", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    app = await buildApp(env);
    await app.ready();
  });
  after(() => app.close());

  it("GET /health is public and returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "ok");
  });

  it("unknown routes return the error envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, "NOT_FOUND");
  });

  for (const url of ["/docs", "/docs/json", "/docs/yaml"]) {
    it(`${url} requires basic auth`, async () => {
      const none = await app.inject({ method: "GET", url });
      assert.equal(none.statusCode, 401);
      assert.match(String(none.headers["www-authenticate"]), /^Basic/);

      const wrong = await app.inject({
        method: "GET",
        url,
        headers: { authorization: basic("docs", "wrong") },
      });
      assert.equal(wrong.statusCode, 401);
    });
  }

  it("serves the OpenAPI spec with valid credentials", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/docs/json",
      headers: { authorization: basic("docs", "docs-password") },
    });
    assert.equal(res.statusCode, 200);
    const spec = res.json();
    assert.equal(spec.openapi, "3.1.0");
    assert.equal(spec.info.title, "Ad Performance API");
    assert.ok(spec.paths["/health"]);
    assert.ok(spec.components.securitySchemes.bearerAuth);
  });

  it("rejects a weak configuration at startup", () => {
    assert.throws(() => loadEnv({ JWT_SECRET: "short", DOCS_USER: "", DOCS_PASSWORD: "x" }), /JWT_SECRET/);
  });
});
