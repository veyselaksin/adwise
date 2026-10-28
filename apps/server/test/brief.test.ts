import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { testEnv } from "./helpers.js";

describe("releases and morning brief", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const get = (url: string, auth = true) =>
    app.inject({ method: "GET", url, headers: auth ? { authorization: `Bearer ${token}` } : {} });

  before(async () => {
    app = await buildApp(testEnv());
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    token = res.json().data.token;
  });
  after(() => app.close());

  describe("GET /releases", () => {
    it("lists releases in a range with their commits", async () => {
      const res = await get("/releases?from=2026-10-01&to=2026-10-14");
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.deepEqual(
        body.data.map((r: { platform: string; version: string; date: string }) => `${r.platform} ${r.version} ${r.date}`),
        ["ios 3.45.0 2026-10-02", "android 3.45.0 2026-10-06", "ios 3.46.0 2026-10-09", "android 3.46.0 2026-10-13"],
      );
      assert.ok(body.data[0].commits.length > 0);
      assert.ok("type" in body.data[0].commits[0] && "body" in body.data[0].commits[0]);
    });

    it("filters by platform and returns all without a range", async () => {
      assert.equal((await get("/releases?platform=android")).json().data.length, 6);
      assert.equal((await get("/releases")).json().data.length, 12);
    });

    it("validates and needs a token", async () => {
      assert.equal((await get("/releases?from=yesterday")).json().error.code, "VALIDATION_ERROR");
      assert.equal((await get("/releases", false)).statusCode, 401);
    });
  });

  describe("GET /brief", () => {
    it("judges yesterday by cost per trial against last week (reference example 4)", async () => {
      const res = await get("/brief");
      assert.equal(res.statusCode, 200);
      const brief = res.json().data;
      assert.equal(brief.date, "2026-10-14");
      assert.deepEqual(brief.week, { from: "2026-10-05", to: "2026-10-11" });
      assert.deepEqual(brief.weekBefore, { from: "2026-09-28", to: "2026-10-04" });
      assert.equal(brief.yesterday.cacFinal, false);
      assert.equal(brief.baseline.cacFinal, true);
      // Example 4: CAC $200.25 yesterday, cost per trial $12.23 against $12.02 for Oct 5–11.
      assert.equal(brief.yesterday.cac.toFixed(2), "200.25");
      assert.equal(brief.yesterday.cost_per_trial.toFixed(2), "12.23");
      assert.equal(brief.baseline.cost_per_trial.toFixed(2), "12.02");
      assert.match(brief.headline, /\$12\.23 per trial, against \$12\.02 last week, about flat/);
      assert.match(brief.headline, /CAC isn't final/);
    });

    it("lists items needing a look first, each campaign item with a range to investigate", async () => {
      const { items } = (await get("/brief")).json().data;
      const tones = items.map((i: { tone: string }) => i.tone);
      assert.deepEqual(tones, [...tones].sort((a: string, b: string) => ["bad", "good", "info"].indexOf(a) - ["bad", "good", "info"].indexOf(b)));
      for (const item of items) {
        if (item.kind === "release") assert.equal(item.investigate, undefined);
        else assert.match(item.investigate.campaignId, /^c_\d+$/);
      }
      const ttde = items.find((i: { id: string }) => i.id === "cac:c_203");
      assert.ok(ttde, "TikTok DE's CAC rose 45% week over week");
      assert.equal(ttde.tone, "bad");
      assert.deepEqual(ttde.investigate, { campaignId: "c_203", from: "2026-10-05", to: "2026-10-11" });
      assert.deepEqual(
        items.filter((i: { kind: string }) => i.kind === "release").map((i: { id: string }) => i.id),
        ["release:ios-3.46.0", "release:android-3.46.0"],
      );
    });

    it("needs a token", async () => {
      assert.equal((await get("/brief", false)).statusCode, 401);
    });
  });
});
