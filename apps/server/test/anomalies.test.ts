import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { ModelError } from "../src/clients/zenmux.client.js";
import { ANOMALY_RULES, ANOMALY_SETTINGS } from "../src/constants/anomalies.constant.js";
import { classify, dayTypeOf, detectAnomalies, metricValue, robustBaseline } from "../src/lib/anomalies.js";
import { addDays } from "../src/lib/dates.js";
import type { Anomaly, CampaignSeries, DetectionInput } from "../src/types/anomalies.type.js";
import type { AgentEvent, ModelClient, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import type { BaseTotals } from "../src/types/metrics.type.js";
import { testEnv } from "./helpers.js";

/* ------------------------------------------------- synthetic unit fixtures */

const START = "2026-08-03"; // a Monday
const LAST = addDays(START, 34); // 35 days: four full weeks of baseline before the last week

/** A steady day with small, deterministic wobble (±4%), like a campaign that isn't doing anything odd. */
function normalDay(i: number): BaseTotals {
  const w = 1 + 0.04 * Math.sin(i * 1.7);
  const v = 1 + 0.04 * Math.cos(i * 2.3);
  return {
    spend: 1000 * w,
    impressions: Math.round(100_000 * v),
    clicks: Math.round(3000 * w * v),
    installs: Math.round(500 * v),
    trials: Math.round(200 * v),
    trial_conversions: Math.round(80 * v),
    subscriptions: Math.round(40 * v),
    d7_revenue: 800 * w * v,
  };
}

function series(id: string, overrides: Record<string, Partial<BaseTotals>> = {}, days = 35, start = START): CampaignSeries {
  const map = new Map<string, BaseTotals>();
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    map.set(date, { ...normalDay(i), ...overrides[date] });
  }
  return { campaign: { id, name: `Campaign ${id}`, channel: "meta", country: "US" }, days: map };
}

const detect = (s: CampaignSeries[], extra: Partial<DetectionInput> = {}) =>
  detectAnomalies({
    series: s,
    range: { from: LAST, to: LAST },
    firstDataDate: START,
    // Well past the range: every metric final and settled, unless a test says otherwise.
    finalThrough: () => addDays(LAST, 7),
    ...extra,
  });

describe("anomaly detection (synthetic fixtures)", () => {
  it("flags a genuine CAC spike with the campaign, values, rule and an investigate range", () => {
    const { anomalies } = detect([series("c_1", { [LAST]: { subscriptions: 16 } })], { types: ["cac_increase"] });
    assert.equal(anomalies.length, 1);
    const a = anomalies[0]!;
    assert.equal(a.id, `c_1:cac_increase:${LAST}`);
    assert.equal(a.campaign.id, "c_1");
    assert.equal(a.metric, "cac");
    assert.equal(a.definition, "Spend ÷ subscriptions");
    assert.equal(a.observed.toFixed(2), (normalDay(34).spend / 16).toFixed(2));
    assert.ok(a.pctChange! > 1, "CAC more than doubled");
    assert.equal(a.severity, "low", "16 subscriptions is under the team's 20, so capped");
    assert.match(a.caveat!, /Only 16 subscriptions on the day, under the team's 20/);
    assert.match(a.rule, /^CAC \+30% or more against the median of 8 weekend days in the last 28, and 3\+ robust z/);
    assert.match(a.explanation, /^CAC was \$\d+\.\d\d on Sep 6 \(Sunday\), \d+\.\d% above the median of \$\d+\.\d\d over 8 weekend days/);
    assert.deepEqual(a.investigate, { campaignId: "c_1", from: addDays(LAST, -6), to: LAST });
  });

  it("carries the baseline days for the chart, oldest first, with the spread behind the score", () => {
    const { anomalies } = detect([series("c_1", { [LAST]: { subscriptions: 16 } })], { types: ["cac_increase"] });
    const a = anomalies[0]!;
    assert.equal(a.history.length, a.baselineWindow.days);
    assert.equal(a.history[0]!.date, a.baselineWindow.from);
    assert.equal(a.history.at(-1)!.date, a.baselineWindow.to);
    assert.ok(a.history.every((h, i) => i === 0 || h.date > a.history[i - 1]!.date));
    assert.ok(a.history.every((h) => dayTypeOf(h.date) === a.dayType));
    assert.equal(a.score.toFixed(1), ((a.observed - a.baseline) / a.spread).toFixed(1));
    assert.deepEqual(a.caps, ["small_sample"]);
  });

  it("rates a large, well-sampled move high", () => {
    // Spend tripled on a normal day: far beyond every threshold, on plenty of volume.
    const { anomalies } = detect([series("c_1", { [LAST]: { spend: 3000 } })], { types: ["spend_spike", "cac_increase", "cpc_increase"] });
    const byType = Object.fromEntries(anomalies.map((a) => [a.type, a]));
    assert.equal(byType.spend_spike?.severity, "high");
    assert.equal(byType.cpc_increase?.severity, "high");
    assert.equal(byType.cac_increase?.severity, "high");
  });

  it("leaves normal day-to-day variation alone", () => {
    const res = detect([series("c_1")], { range: { from: addDays(START, 28), to: LAST } });
    assert.deepEqual(res.anomalies, []);
    assert.ok(res.checks > 0);
    assert.equal(res.skipped.short_history, 0);
  });

  it("doesn't flag ordinary weekends when weekends always run differently", () => {
    // Weekends spend 40% less every week: compared with weekends, Sunday is normal.
    const overrides: Record<string, Partial<BaseTotals>> = {};
    for (let i = 0; i < 35; i++) {
      const d = addDays(START, i);
      if (dayTypeOf(d) === "weekend") overrides[d] = { spend: 600 * (1 + 0.03 * Math.sin(i)) };
    }
    assert.equal(dayTypeOf(LAST), "weekend");
    assert.deepEqual(detect([series("c_1", overrides)], { types: ["spend_drop"] }).anomalies, []);
    // Mixing weekdays into the baseline would have flagged it.
    const mixed = detect([series("c_1", overrides)], { types: ["spend_drop"], settings: { ...ANOMALY_SETTINGS, splitWeekends: false } });
    assert.equal(mixed.anomalies.length, 1);
  });

  it("skips days without enough history instead of guessing", () => {
    const short = series("c_1", { [addDays(START, 4)]: { spend: 5000 } }, 5);
    const res = detect([short], { range: { from: START, to: addDays(START, 4) }, types: ["spend_spike"] });
    assert.deepEqual(res.anomalies, []);
    assert.equal(res.skipped.short_history, 5);
  });

  it("handles zero denominators and missing days without false flags", () => {
    const s = series("c_1", { [LAST]: { subscriptions: 0, clicks: 0, impressions: 0 } });
    const res = detect([s], { types: ["cac_increase", "cpc_increase", "ctr_decrease"] });
    assert.deepEqual(res.anomalies, []);
    assert.equal(res.skipped.low_volume, 3);
    assert.equal(metricValue("cac", s.days.get(LAST)!), null);
    assert.equal(metricValue("ctr", s.days.get(LAST)!), null);

    const gap = series("c_1");
    gap.days.delete(LAST);
    assert.equal(detect([gap], { types: ["spend_drop"] }).skipped.no_data, 1);

    // A metric that is 0 on every baseline day has no relative change to speak of.
    const zero: Record<string, Partial<BaseTotals>> = {};
    for (let i = 0; i < 35; i++) zero[addDays(START, i)] = { d7_revenue: 0 };
    zero[LAST] = { d7_revenue: 500 };
    assert.equal(detect([series("c_1", zero)], { types: ["roas_decrease"] }).skipped.flat_baseline, 1);
  });

  it("only checks metrics on days the team counts as final", () => {
    const s = series("c_1", { [LAST]: { subscriptions: 10 } });
    const res = detect([s], { types: ["cac_increase", "spend_spike"], finalThrough: (m) => (m === "cac" ? addDays(LAST, -4) : LAST) });
    assert.equal(res.skipped.not_final, 1);
    assert.equal(res.anomalies.length, 0);
  });

  it("caps a flag on the newest final day at low and says why", () => {
    const s = series("c_1", { [LAST]: { spend: 3000 } });
    const { anomalies } = detect([s], { types: ["cac_increase", "spend_spike"], finalThrough: () => LAST });
    // `finalThrough` is the last day here, for every metric: only maturing metrics settle.
    const cac = anomalies.find((a) => a.type === "cac_increase")!;
    assert.equal(cac.severity, "low");
    assert.match(cac.caveat!, /newest day the team counts as final for CAC/);
    assert.equal(anomalies.find((a) => a.type === "spend_spike")!.caveat, undefined);
  });

  it("flags fewer conversions only when spend held", () => {
    const held = detect([series("c_1", { [LAST]: { subscriptions: 15 } })], { types: ["conversion_drop"] });
    assert.equal(held.anomalies.length, 1);
    assert.ok(held.anomalies[0]!.spend!.pctChange! > -0.1);
    assert.match(held.anomalies[0]!.explanation, /Spend held at/);

    const cut = detect([series("c_1", { [LAST]: { subscriptions: 15, spend: 400 } })], { types: ["conversion_drop"] });
    assert.deepEqual(cut.anomalies, []);
  });

  it("names the right campaign when only one of several moved", () => {
    const res = detect([series("c_1"), series("c_2", { [LAST]: { spend: 3000 } }), series("c_3")], { types: ["spend_spike"] });
    assert.deepEqual(res.anomalies.map((a) => a.campaign.id), ["c_2"]);
  });

  it("gives identical results for identical inputs, whatever the input order", () => {
    const make = () => [series("c_2", { [LAST]: { spend: 3000 } }), series("c_1", { [LAST]: { subscriptions: 15 } })];
    const a = detect(make());
    const b = detect(make().reverse());
    assert.deepEqual(a, b);
    const ids = a.anomalies.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, "one record per campaign, rule and day");
  });

  it("classifies severity from both the score and the size of the change", () => {
    const rule = ANOMALY_RULES.cac_increase; // trigger 30%, medium 45%, high 60%
    assert.equal(classify(3.2, 0.35, rule, ANOMALY_SETTINGS), "low");
    assert.equal(classify(5, 0.5, rule, ANOMALY_SETTINGS), "medium");
    assert.equal(classify(7, 0.7, rule, ANOMALY_SETTINGS), "high");
    assert.equal(classify(9, 0.4, rule, ANOMALY_SETTINGS), "low", "a big score on a small change stays low");
    assert.equal(classify(-7, -0.7, ANOMALY_RULES.ctr_decrease, ANOMALY_SETTINGS), "high");
  });

  it("never lets a perfectly steady baseline make every cent unusual", () => {
    const { center, spread } = robustBaseline([500, 500, 500, 500, 500, 500], ANOMALY_SETTINGS.minRelativeSpread);
    assert.equal(center, 500);
    assert.equal(spread, 25);
  });
});

/* ------------------------------------------------- the route, on the case data */

/** A model that always fails, as when the provider is down. */
class DownModel implements ModelClient {
  calls = 0;
  // eslint-disable-next-line require-yield -- fails before streaming anything
  async *stream(): AsyncGenerator<string, ModelResponse> {
    this.calls++;
    throw new ModelError("MODEL_UNAVAILABLE", "provider down");
  }
}

describe("GET /anomalies", () => {
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

  it("checks the last 14 days by default, in the envelope", async () => {
    const res = await get("/anomalies");
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.match(body.message, /^\d+ anomal(y|ies) found$/);
    const r = body.data;
    assert.deepEqual(r.range, { from: "2026-10-01", to: "2026-10-14" });
    assert.deepEqual(r.finalThrough, { cac: "2026-10-11", subscriptions: "2026-10-11", d7_roas: "2026-10-08" });
    assert.equal(r.summary.campaignsChecked, 7);
    assert.equal(r.summary.total, r.anomalies.length);
    assert.equal(r.method.rules.length, 7);
    for (const a of r.anomalies as Anomaly[]) {
      assert.ok(a.date >= r.range.from && a.date <= r.range.to);
      assert.match(a.campaign.id, /^c_\d+$/);
    }
  });

  it("finds the case data's anomalies and keeps the settling day low", async () => {
    const r = (await get("/anomalies?from=2026-09-03&to=2026-10-14")).json().data;
    const a = (r.anomalies as Anomaly[]).find((x) => x.id === "c_104:cac_increase:2026-10-08");
    assert.ok(a, "Meta BR's CAC on Oct 8, on 25 subscriptions");
    assert.equal(a.severity, "medium");
    assert.equal(a.campaign.name, "LIV_META_BR_Subs");
    assert.equal(a.caveat, undefined);
    // Oct 11 is the newest day the team counts as final for CAC; it still reads high everywhere.
    const oct11 = (r.anomalies as Anomaly[]).filter((x) => x.date === "2026-10-11");
    assert.ok(oct11.length > 0);
    assert.ok(oct11.every((x) => x.severity === "low" && /newest day the team counts as final/.test(x.caveat!)));
    // Nothing on days whose CAC isn't final yet.
    assert.ok(!(r.anomalies as Anomaly[]).some((x) => x.metric === "cac" && x.date > "2026-10-11"));
    const ids = (r.anomalies as Anomaly[]).map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    // The first weeks have no baseline yet: said, not hidden.
    assert.ok(r.coverage.skipped.short_history > 0);
  });

  it("hides capped flags on request and says what it left out", async () => {
    const url = "/anomalies?from=2026-09-03&to=2026-10-14";
    const all = (await get(url)).json().data;
    const shown = (await get(`${url}&capped=hide`)).json().data;
    assert.equal(all.hiddenCapped, null);
    assert.equal(shown.filters.capped, "hide");
    assert.ok((shown.anomalies as Anomaly[]).every((a) => a.caps.length === 0));
    const capped = (all.anomalies as Anomaly[]).filter((a) => a.caps.length > 0);
    assert.equal(shown.hiddenCapped.total, capped.length);
    assert.equal(shown.summary.total + shown.hiddenCapped.total, all.summary.total);
    const oct11 = shown.hiddenCapped.settling.find((d: { date: string }) => d.date === "2026-10-11");
    assert.equal(oct11.campaigns, new Set(capped.filter((a) => a.date === "2026-10-11").map((a) => a.campaign.id)).size);
    assert.ok(oct11.metrics.includes("CAC"));
    assert.ok((shown.anomalies as Anomaly[]).some((a) => a.id === "c_104:cac_increase:2026-10-08"));
    assert.equal((await get("/anomalies?capped=maybe")).json().error.code, "VALIDATION_ERROR");
  });

  it("returns the same report for the same request", async () => {
    const a = (await get("/anomalies?from=2026-09-20&to=2026-10-14")).json().data;
    const b = (await get("/anomalies?from=2026-09-20&to=2026-10-14")).json().data;
    assert.deepEqual(a, b);
  });

  it("filters by channel, country and type", async () => {
    const all = (await get("/anomalies?from=2026-09-03&to=2026-10-14")).json().data.anomalies as Anomaly[];
    const meta = (await get("/anomalies?from=2026-09-03&to=2026-10-14&channel=meta")).json().data;
    assert.equal(meta.filters.channel, "meta");
    assert.ok((meta.anomalies as Anomaly[]).every((a) => a.campaign.channel === "meta"));
    assert.equal(meta.anomalies.length, all.filter((a) => a.campaign.channel === "meta").length);

    const br = (await get("/anomalies?from=2026-09-03&to=2026-10-14&country=BR")).json().data;
    assert.ok((br.anomalies as Anomaly[]).every((a) => a.campaign.country === "BR"));
    assert.equal(br.summary.campaignsChecked, 2);

    const cac = (await get("/anomalies?from=2026-09-03&to=2026-10-14&type=cac_increase")).json().data;
    assert.ok((cac.anomalies as Anomaly[]).every((a) => a.type === "cac_increase"));
    assert.equal(cac.anomalies.length, all.filter((a) => a.type === "cac_increase").length);
  });

  it("validates dates, ranges and filters", async () => {
    const code = async (url: string) => (await get(url)).json().error.code;
    assert.equal(await code("/anomalies?from=yesterday&to=2026-10-14"), "VALIDATION_ERROR");
    assert.equal(await code("/anomalies?from=2026-02-30&to=2026-10-14"), "INVALID_DATE");
    assert.equal(await code("/anomalies?from=2026-10-10&to=2026-10-01"), "INVALID_RANGE");
    assert.equal(await code("/anomalies?from=2026-10-01"), "MISSING_RANGE");
    assert.equal(await code("/anomalies?from=2026-08-01&to=2026-10-14"), "RANGE_OUTSIDE_DATA");
    assert.equal(await code("/anomalies?from=2026-10-01&to=2026-10-15"), "RANGE_OUTSIDE_DATA");
    assert.equal(await code("/anomalies?type=everything"), "VALIDATION_ERROR");
    assert.equal(await code("/anomalies?channel=google"), "VALIDATION_ERROR");
    assert.equal(await code("/anomalies?country=FR"), "VALIDATION_ERROR");
    assert.equal((await get("/anomalies?from=2026-10-01&to=2026-10-15")).statusCode, 400);
  });

  it("needs a token", async () => {
    assert.equal((await get("/anomalies", false)).statusCode, 401);
  });

  it("keeps working when the AI provider is down", async () => {
    const model = new DownModel();
    const down = await buildApp(testEnv(), {}, { model });
    try {
      const login = await down.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
      const auth = { authorization: `Bearer ${login.json().data.token}` };
      const url = "/anomalies?from=2026-09-20&to=2026-10-14";
      const res = await down.inject({ method: "GET", url, headers: auth });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().data, (await get(url)).json().data);
      assert.equal(model.calls, 0, "detection never calls the model");

      // Asking the agent about it fails cleanly, as an error event, not a broken request.
      const chat = await down.inject({
        method: "POST",
        url: "/agent/chat",
        headers: auth,
        payload: { messages: [{ role: "user", text: "Investigate anomaly c_104:cac_increase:2026-10-08" }] },
      });
      assert.equal(chat.statusCode, 200);
      const events = chat.payload.trim().split("\n").map((l) => JSON.parse(l) as AgentEvent);
      assert.ok(events.some((e) => e.type === "error" && e.code === "MODEL_UNAVAILABLE"));
    } finally {
      await down.close();
    }
  });
});

describe("get_anomalies (agent tool)", () => {
  it("hands the model the monitor's own figures", async () => {
    const requests: ModelRequest[] = [];
    const usage = { inputTokens: 10, outputTokens: 5 };
    const model: ModelClient = {
      // eslint-disable-next-line require-yield -- answers without streaming text
      async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
        requests.push(structuredClone({ ...req, signal: undefined }));
        if (requests.length === 1) {
          const args = { from: "2026-09-03", to: "2026-10-14", campaign_id: "c_104", date: "2026-10-08" };
          return {
            message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_anomalies", arguments: JSON.stringify(args) } }] },
            usage,
          };
        }
        return { message: { role: "assistant", content: "Done." }, usage };
      },
    };
    const app = await buildApp(testEnv(), {}, { model });
    try {
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
      await app.inject({
        method: "POST",
        url: "/agent/chat",
        headers: { authorization: `Bearer ${login.json().data.token}` },
        payload: { messages: [{ role: "user", text: "Why was Meta BR flagged on Oct 8?" }] },
      });
      const toolMsg = requests[1]!.messages.at(-1) as { role: string; content: string };
      assert.equal(toolMsg.role, "tool");
      const data = JSON.parse(toolMsg.content) as { anomalies: { id: string; observed: number; baseline: number; rule: string }[] };
      const cac = data.anomalies.find((a) => a.id === "c_104:cac_increase:2026-10-08");
      assert.ok(cac);

      const route = (await app.services.anomalies.report({ from: "2026-10-08", to: "2026-10-08" })).anomalies.find((a) => a.id === cac.id)!;
      assert.equal(cac.observed, Math.round(route.observed * 100) / 100);
      assert.equal(cac.rule, route.rule);
    } finally {
      await app.close();
    }
  });
});
