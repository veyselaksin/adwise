import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { testEnv } from "./helpers.js";

describe("auth and metrics routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";

  const login = (username: string, password: string) =>
    app.inject({ method: "POST", url: "/auth/login", payload: { username, password } });
  const authed = () => ({ authorization: `Bearer ${token}` });

  before(async () => {
    app = await buildApp(testEnv());
    await app.ready();
    token = (await login("marketing", "app-password")).json().data.token;
  });
  after(() => app.close());

  describe("POST /auth/login", () => {
    it("issues a token for the right credentials", async () => {
      const res = await login("marketing", "app-password");
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.user, "marketing");
      assert.equal(body.data.expiresIn, 43200);
      assert.match(body.data.token, /^ey/);
    });

    it("rejects wrong credentials", async () => {
      const res = await login("marketing", "nope-nope");
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.json(), {
        success: false,
        message: "Wrong username or password",
        error: { code: "INVALID_CREDENTIALS" },
      });
    });

    it("validates the body", async () => {
      const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "x" } });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, "VALIDATION_ERROR");
    });

    it("rate limits guessing", async () => {
      const fresh = await buildApp(testEnv());
      try {
        const codes: number[] = [];
        for (let i = 0; i < 11; i++) {
          const res = await fresh.inject({
            method: "POST",
            url: "/auth/login",
            payload: { username: "a", password: "b" },
          });
          codes.push(res.statusCode);
        }
        assert.equal(codes.at(-1), 429);
        assert.ok(codes.slice(0, 10).every((c) => c === 401));
      } finally {
        await fresh.close();
      }
    });
  });

  describe("POST /metrics/query", () => {
    const query = (payload: object, headers = authed()) =>
      app.inject({ method: "POST", url: "/metrics/query", headers, payload });

    it("returns rows, blended totals and the previous period", async () => {
      const res = await query({ preset: "last_week", groupBy: ["channel"], compare: true });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.message, "Metrics loaded");
      assert.deepEqual(body.data.range, { from: "2026-10-05", to: "2026-10-11" });
      assert.deepEqual(
        body.data.rows.map((r: { channel: string; spend: number }) => [r.channel, r.spend]),
        [
          ["meta", 37142.36],
          ["tiktok", 24414.14],
        ],
      );
      assert.equal(body.data.totals.spend, 61556.5);
      assert.equal(body.data.totals.cac.toFixed(2), "27.62");
      assert.deepEqual(body.data.previous.range, { from: "2026-09-28", to: "2026-10-04" });
    });

    it("keeps ad rows labelled with their ad set and flags provisional metrics", async () => {
      const res = await query({
        range: { from: "2026-10-12", to: "2026-10-14" },
        groupBy: ["ad"],
        filters: { countries: ["US"], adStatus: "active" },
        orderBy: { metric: "spend", direction: "desc" },
        limit: 2,
      });
      assert.equal(res.statusCode, 200);
      const { rows } = res.json().data;
      assert.equal(rows.length, 2);
      assert.ok(rows[0].ad_name && rows[0].adset_name && rows[0].campaign_name);
      assert.ok(rows[0].provisional.includes("cac"));
    });

    it("requires a token", async () => {
      const res = await query({ preset: "yesterday" }, { authorization: "Bearer not-a-token" });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, "UNAUTHORIZED");
    });

    it("validates the body", async () => {
      const bad = await query({ preset: "last_year" });
      assert.equal(bad.statusCode, 400);
      assert.equal(bad.json().error.code, "VALIDATION_ERROR");

      const missing = await query({ groupBy: ["channel"] });
      assert.equal(missing.statusCode, 400);
      assert.equal(missing.json().error.code, "MISSING_RANGE");

      const reversed = await query({ range: { from: "2026-10-10", to: "2026-10-01" } });
      assert.equal(reversed.statusCode, 400);
      assert.equal(reversed.json().error.code, "INVALID_RANGE");
    });
  });

  describe("GET /metrics/catalog and /entities", () => {
    it("describes metrics, maturity and named periods", async () => {
      const res = await app.inject({ method: "GET", url: "/metrics/catalog", headers: authed() });
      assert.equal(res.statusCode, 200);
      const { data } = res.json();
      assert.equal(data.today, "2026-10-15");
      const cac = data.metrics.find((m: { key: string }) => m.key === "cac");
      assert.deepEqual(
        [cac.formula, cac.finalAfterDays, cac.lastFinalDate],
        ["spend ÷ subscriptions", 4, "2026-10-11"],
      );
      assert.ok(data.presets.some((p: { key: string }) => p.key === "last_week"));
    });

    it("lists campaigns, ad sets with budgets, and ads", async () => {
      const res = await app.inject({ method: "GET", url: "/entities", headers: authed() });
      assert.equal(res.statusCode, 200);
      const { data } = res.json();
      assert.equal(data.campaigns.length, 7);
      assert.equal(data.adsets.length, 13);
      assert.equal(data.ads.length, 53);
      assert.equal(data.adsets.find((a: { name: string }) => a.name === "US_Broad_02").daily_budget_usd, 1080);
    });

    it("require a token", async () => {
      for (const url of ["/metrics/catalog", "/entities"]) {
        const res = await app.inject({ method: "GET", url });
        assert.equal(res.statusCode, 401);
      }
    });
  });
});
