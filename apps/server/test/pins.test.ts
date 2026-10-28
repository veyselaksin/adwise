import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { PIN_MAX_ROWS } from "../src/constants/pins.constant.js";
import { PinsService } from "../src/services/pins.service.js";
import { testEnv } from "./helpers.js";

describe("pinned tiles", () => {
  const env = testEnv();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: object, auth = true) =>
    app.inject({ method, url, ...(payload && { payload }), headers: auth ? { authorization: `Bearer ${token}` } : {} });
  const query = { preset: "last_week", group_by: ["channel"], metrics: ["spend", "cac", "cost_per_trial"], compare: true };

  before(async () => {
    app = await buildApp(env);
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    token = res.json().data.token;
  });
  after(() => app.close());

  it("starts empty and needs a token", async () => {
    assert.deepEqual((await call("GET", "/pins")).json(), { success: true, message: "Pinned tiles loaded", data: [] });
    assert.equal((await call("GET", "/pins", undefined, false)).statusCode, 401);
  });

  it("pins an agent call, keeps it on disk, and re-runs it like the agent's tool", async () => {
    const res = await call("POST", "/pins", { title: "  CAC by channel,   last week ", query });
    assert.equal(res.statusCode, 200);
    const pin = res.json().data;
    assert.equal(pin.title, "CAC by channel, last week");
    assert.equal(pin.label, "spend, cac, cost_per_trial by channel · last week · vs previous");
    assert.deepEqual(pin.query, query);
    assert.deepEqual((await PinsService.load(env.PINS_PATH, app.services.metrics)).list(), [pin]);

    const tile = (await call("GET", `/pins/${pin.id}/result`)).json().data;
    assert.deepEqual(tile.metrics, ["spend", "cac", "cost_per_trial"]);
    assert.deepEqual(tile.result.range, { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(tile.result.previous.range, { from: "2026-09-28", to: "2026-10-04" });
    // Same numbers as the dashboard's own query.
    const direct = await app.services.metrics.query({ range: tile.result.range, groupBy: ["channel"] });
    assert.equal(tile.result.totals.cac, direct.totals.cac);
    assert.deepEqual(tile.result.rows.map((r: { channel: string }) => r.channel).sort(), ["meta", "tiktok"]);
  });

  it("caps a tile's rows but keeps totals over all of them", async () => {
    const pin = (await call("POST", "/pins", { title: "Ads", query: { preset: "last_7_days", group_by: ["ad"] } })).json().data;
    const tile = (await call("GET", `/pins/${pin.id}/result`)).json().data;
    assert.equal(tile.result.rows.length, PIN_MAX_ROWS);
    assert.ok(tile.rowsOmitted > 0);
    const all = await app.services.metrics.query({ range: tile.result.range });
    assert.equal(tile.result.totals.spend, all.totals.spend);
  });

  it("rejects calls the tool would reject", async () => {
    const cases: [object, string][] = [
      [{ title: "x", query: { group_by: ["channel"] } }, "MISSING_RANGE"],
      [{ title: "x", query: { preset: "last_7_days", group_by: ["planet"] } }, "INVALID_QUERY"],
      [{ title: "x", query: { preset: "forever" } }, "INVALID_QUERY"],
      [{ title: "   ", query: { preset: "last_7_days" } }, "EMPTY_TITLE"],
    ];
    for (const [payload, code] of cases) {
      const res = await call("POST", "/pins", payload);
      assert.equal(res.statusCode, 400, code);
      assert.equal(res.json().error.code, code);
    }
  });

  it("removes a tile", async () => {
    const [pin] = (await call("GET", "/pins")).json().data;
    assert.equal((await call("DELETE", `/pins/${pin.id}`)).json().data.id, pin.id);
    assert.equal((await call("GET", `/pins/${pin.id}/result`)).json().error.code, "PIN_NOT_FOUND");
    assert.equal((await call("DELETE", `/pins/${pin.id}`)).statusCode, 404);
  });
});
