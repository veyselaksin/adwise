import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { ModelError } from "../src/clients/zenmux.client.js";
import { METRICS } from "../src/constants/metrics.constant.js";
import { cacDrivers, changeOf, shareOf } from "../src/lib/compare.js";
import { parseInterpretation, sanitizeInterpretation, unverifiedFigures } from "../src/services/investigation.guard.js";
import { breakdown, compareMetric, InvestigationService } from "../src/services/investigation.service.js";
import { deriveMetrics, type MetricsService } from "../src/services/metrics.service.js";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import type { InvestigationEvent, InvestigationFacts } from "../src/types/investigation.type.js";
import type { BaseTotals, MetricRow } from "../src/types/metrics.type.js";
import { testEnv } from "./helpers.js";

const usage = { inputTokens: 100, outputTokens: 10 };

/** Replays fixed responses (or throws) and records every request. */
class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: (step: number, req: ModelRequest) => ModelResponse) {}
  // eslint-disable-next-line require-yield
  async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    return this.script(this.requests.length, req);
  }
}
const reply = (text: string): ModelResponse => ({ message: { role: "assistant", content: text }, usage });

const events = (payload: string) =>
  payload
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as InvestigationEvent);
const factsOf = (list: InvestigationEvent[]) => (list.find((e) => e.type === "facts") as Extract<InvestigationEvent, { type: "facts" }>).facts;

const row = (sums: Partial<BaseTotals>, provisional: MetricRow["provisional"] = []): MetricRow => {
  const totals: BaseTotals = {
    spend: 0,
    impressions: 0,
    clicks: 0,
    installs: 0,
    trials: 0,
    trial_conversions: 0,
    subscriptions: 0,
    d7_revenue: 0,
    ...sums,
  };
  return { ...totals, ...deriveMetrics(totals), provisional };
};

const CAMPAIGN = "c_101";
const PERIOD = { from: "2026-10-01", to: "2026-10-14" };
const PREVIOUS = { from: "2026-09-17", to: "2026-09-30" };

describe("period comparison", () => {
  it("computes absolute and relative change", () => {
    assert.deepEqual(changeOf(100, 125), { absChange: 25, pctChange: 0.25 });
    assert.deepEqual(changeOf(80, 60), { absChange: -20, pctChange: -0.25 });
    assert.deepEqual(changeOf(5, 5), { absChange: 0, pctChange: 0 });
  });

  it("gives no relative change from zero and nothing for missing values", () => {
    assert.deepEqual(changeOf(0, 40), { absChange: 40, pctChange: null });
    assert.deepEqual(changeOf(null, 40), { absChange: null, pctChange: null });
    assert.deepEqual(changeOf(12, undefined), { absChange: null, pctChange: null });
    assert.deepEqual(changeOf(Number.NaN, 1), { absChange: null, pctChange: null });
    assert.equal(shareOf(5, 0), null);
    assert.equal(shareOf(5, 10), 0.5);
  });

  it("splits a CAC change into funnel steps whose shares add up to 1", () => {
    const prev = { spend: 1000, impressions: 100_000, clicks: 2000, installs: 400, subscriptions: 40 };
    const cur = { spend: 1200, impressions: 100_000, clicks: 1500, installs: 330, subscriptions: 30 };
    const drivers = cacDrivers(prev, cur, { subscriptionsProvisional: false });
    assert.ok(drivers.available);
    assert.ok(Math.abs(drivers.cacChange - (1200 / 30 / (1000 / 40) - 1)) < 1e-12);
    const shares = drivers.items.reduce((s, d) => s + d.share!, 0);
    assert.ok(Math.abs(shares - 1) < 1e-9);
    // Effects multiply back to the CAC change.
    const product = drivers.items.reduce((p, d) => p * (1 + d.effectOnCac), 1);
    assert.ok(Math.abs(product - 1 - drivers.cacChange) < 1e-9);
    assert.equal(drivers.items.find((d) => d.key === "ctr")!.previous, 0.02);
  });

  it("doesn't split CAC when a funnel step is zero", () => {
    const prev = { spend: 1000, impressions: 100_000, clicks: 2000, installs: 400, subscriptions: 0 };
    const cur = { spend: 1200, impressions: 100_000, clicks: 1500, installs: 330, subscriptions: 30 };
    assert.equal(cacDrivers(prev, cur, { subscriptionsProvisional: false }).available, false);
  });
});

describe("metric definitions", () => {
  it("uses the glossary's formulas and adds CPC as spend ÷ clicks", () => {
    const prev = row({ spend: 500, impressions: 50_000, clicks: 1000, installs: 200, trials: 50, trial_conversions: 20, subscriptions: 25, d7_revenue: 300 });
    const cur = row({ spend: 600, impressions: 40_000, clicks: 1200, installs: 150, trials: 60, trial_conversions: 15, subscriptions: 20, d7_revenue: 360 });
    for (const key of ["cac", "cpi", "cost_per_trial", "trial_to_sub", "d7_roas", "ctr"] as const) {
      const c = compareMetric(key, prev, cur);
      const { numerator, denominator } = METRICS[key].formula!;
      assert.equal(c.current, cur[numerator] / cur[denominator], key);
      assert.equal(c.formula, `${numerator} ÷ ${denominator}`);
      assert.equal(c.inGlossary, true);
    }
    const cpc = compareMetric("cpc", prev, cur);
    assert.equal(cpc.current, 0.5);
    assert.equal(cpc.previous, 0.5);
    assert.equal(cpc.inGlossary, false);
    assert.equal(cpc.assessment, null);
    assert.equal(compareMetric("cac", prev, cur).assessment, "worse");
    assert.equal(compareMetric("d7_roas", prev, cur).assessment, null);
    assert.equal(compareMetric("subscriptions", prev, cur).assessment, "worse");
    assert.equal(compareMetric("spend", prev, cur).assessment, null);
  });

  it("returns nulls, not Infinity, on zero denominators and empty periods", () => {
    const empty = row({});
    const cur = row({ spend: 100, clicks: 0, subscriptions: 0 });
    for (const key of ["cac", "cpc", "ctr"] as const) {
      const c = compareMetric(key, empty, cur);
      assert.equal(c.current, null, key);
      assert.equal(c.pctChange, null, key);
    }
    assert.deepEqual(breakdown("adset", [], [], 0, 0), { rows: [], total: 0 });
  });

  it("marks maturing metrics as provisional per period", () => {
    const c = compareMetric("cac", row({ spend: 1, subscriptions: 1 }), row({ spend: 1, subscriptions: 1 }, ["cac", "subscriptions"]));
    assert.deepEqual(c.provisional, { previous: false, current: true });
  });
});

describe("guardrails", () => {
  it("accepts only figures the facts back, at the figure's own precision", () => {
    const numbers = [27.62, 0.0912, 1234.5];
    assert.deepEqual(unverifiedFigures("CAC rose to $27.62, up 9.1%, spend $1,234.50", numbers), []);
    assert.deepEqual(unverifiedFigures("about $28 and 9%", numbers), []);
    assert.deepEqual(unverifiedFigures("CAC hit $31.00, up 14.2%", numbers), ["$31.00", "14.2%"]);
    assert.deepEqual(unverifiedFigures("over 4 days and 20 subscriptions", numbers), []);
  });

  it("parses JSON in fences or prose and rejects the wrong shape", () => {
    const json = JSON.stringify({ summary: "S.", findings: [] });
    assert.ok(parseInterpretation(json).ok);
    assert.ok(parseInterpretation("Here you go:\n```json\n" + json + "\n```").ok);
    assert.equal(parseInterpretation("no json here").ok, false);
    assert.equal(parseInterpretation('{"summary": "S.", "findings": [{"title": "x"}]}').ok, false);
    assert.equal(parseInterpretation("{not json}").ok, false);
  });
});

describe("POST /investigations", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const run = (payload: Record<string, unknown>, target = app, auth = true) =>
    target.inject({
      method: "POST",
      url: "/investigations",
      headers: auth ? { authorization: `Bearer ${token}` } : {},
      payload,
    });

  before(async () => {
    app = await buildApp(testEnv());
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    token = res.json().data.token;
  });
  after(() => app.close());

  it("needs a token", async () => {
    const res = await run({ campaignId: CAMPAIGN, ...PERIOD }, app, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().success, false);
  });

  it("validates the campaign and dates before streaming", async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{ campaignId: CAMPAIGN, from: "2026-10-14", to: "2026-10-01" }, 400, "INVALID_RANGE"],
      [{ campaignId: CAMPAIGN, from: "2026-02-30", to: "2026-10-01" }, 400, "INVALID_DATE"],
      [{ campaignId: CAMPAIGN, from: "2026-10-01", to: "2026-10-20" }, 400, "RANGE_OUTSIDE_DATA"],
      [{ campaignId: CAMPAIGN, from: "2026-09-10", to: "2026-10-14" }, 400, "PREVIOUS_PERIOD_UNAVAILABLE"],
      [{ campaignId: "c_999", ...PERIOD }, 404, "CAMPAIGN_NOT_FOUND"],
      [{ campaignId: CAMPAIGN, from: "Oct 1", to: "2026-10-14" }, 400, "VALIDATION_ERROR"],
    ];
    for (const [payload, status, code] of cases) {
      const res = await run(payload);
      assert.equal(res.statusCode, status, code);
      assert.equal(res.json().success, false);
      assert.equal(res.json().error.code, code);
    }
  });

  it("streams verified facts that match the database, then AGENT_DISABLED without a key", async () => {
    const res = await run({ campaignId: CAMPAIGN, ...PERIOD });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] as string, /application\/x-ndjson/);
    const list = events(res.payload);
    assert.deepEqual(
      list.filter((e) => e.type === "stage" && e.status !== "running").map((e) => e.type === "stage" && `${e.key}:${e.status}`),
      ["validate:done", "current:done", "previous:done", "breakdown:done", "releases:done", "interpret:skipped"],
    );
    assert.deepEqual(list.slice(-2).map((e) => e.type), ["error", "done"]);
    assert.equal((list.at(-2) as { code: string }).code, "AGENT_DISABLED");
    assert.equal((list.at(-1) as { model: unknown }).model, null);

    const facts = factsOf(list);
    assert.equal(facts.status, "ok");
    assert.deepEqual(facts.current.range, PERIOD);
    assert.deepEqual(facts.previous.range, PREVIOUS);
    assert.equal(facts.campaign.name, "LIV_META_US_Subs");

    // Independent of the metric layer: Prisma's own aggregate over the campaign's ads.
    for (const [range, side] of [[PERIOD, "current"], [PREVIOUS, "previous"]] as const) {
      const { _sum } = await app.db.adDaily.aggregate({
        _sum: { spendUsd: true, impressions: true, clicks: true, installs: true, trials: true, subscriptions: true },
        where: { date: { gte: range.from, lte: range.to }, ad: { adSet: { campaignId: CAMPAIGN } } },
      });
      const value = (key: string) => facts.metrics.find((m) => m.key === key)![side];
      assert.equal(value("spend"), Math.round(_sum.spendUsd! * 100) / 100);
      assert.equal(value("subscriptions"), _sum.subscriptions);
      assert.equal(value("clicks"), _sum.clicks);
      assert.equal(value("trials"), _sum.trials);
      assert.equal(value("cpc"), value("spend")! / _sum.clicks!);
      assert.equal(value("cac"), value("spend")! / _sum.subscriptions!);
      assert.equal(value("ctr"), _sum.clicks! / _sum.impressions!);
    }

    // Oct 11–14 are under 4 days old, so CAC isn't final and cost per trial leads (team note 5).
    const cac = facts.metrics.find((m) => m.key === "cac")!;
    assert.deepEqual(cac.provisional, { previous: false, current: true });
    assert.equal(facts.headlineMetric, "cost_per_trial");
    assert.match(facts.limitations[0]!, /CAC/);

    // Breakdown shares and daily rows add up to the campaign.
    const daily = facts.daily.filter((d) => d.period === "current");
    assert.equal(daily.length, 14);
    assert.equal(daily.reduce((s, d) => s + d.subscriptions, 0), cac && facts.metrics.find((m) => m.key === "subscriptions")!.current);
    assert.ok(facts.adsets.total > 0 && facts.ads.rows.every((r) => r.adsetName));
  });

  it("lines up the releases in both periods by day", async () => {
    const facts = factsOf(events((await run({ campaignId: CAMPAIGN, ...PERIOD })).payload));
    const ids = facts.releases.map((r) => r.evidenceId);
    assert.deepEqual(ids, [
      "release:ios-3.43.0",
      "release:android-3.43.0",
      "release:ios-3.44.0",
      "release:android-3.44.0",
      "release:ios-3.45.0",
      "release:android-3.45.0",
      "release:ios-3.46.0",
      "release:android-3.46.0",
    ]);
    const ios346 = facts.releases.find((r) => r.evidenceId === "release:ios-3.46.0")!;
    assert.equal(ios346.period, "current");
    assert.equal(ios346.dayOffset, 8);
    const ios343 = facts.releases.find((r) => r.evidenceId === "release:ios-3.43.0")!;
    assert.equal(ios343.period, "previous");
    assert.equal(ios343.dayOffset, -13);
  });

  describe("with a model", () => {
    const withModel = async (model: ModelClient) => {
      const scripted = await buildApp(testEnv({ ZENMUX_API_KEY: "" }), {}, { model });
      await scripted.ready();
      return scripted;
    };

    it("keeps only findings with real evidence and figures from the facts", async () => {
      const model = new ScriptedModel(() =>
        reply(
          "```json\n" +
            JSON.stringify({
              summary: "Cost per trial moved. CAC jumped to $999.99 overnight.",
              findings: [
                { title: "Cost per trial changed", explanation: "See the metric.", evidence: ["metric:cost_per_trial", "metric:nope"], kind: "verified", confidence: "high" },
                { title: "Made-up ad set", explanation: "x", evidence: ["adset:as_000"], kind: "verified", confidence: "high" },
                { title: "Invented figure", explanation: "Installs fell 87.3%.", evidence: ["metric:installs"], kind: "verified", confidence: "medium" },
                { title: "Paywall release", explanation: "Might matter.", evidence: ["release:ios-3.46.0"], kind: "hypothesis", confidence: "low" },
              ],
              releaseNotes: [
                { release: "ios-3.46.0", relevance: "Shipped mid-period." },
                { release: "release:ios-9.9.9", relevance: "Not real." },
              ],
              nextSteps: ["Check cost per trial again in 4 days.", "Raise budget by 412.7%."],
              limitations: [],
            }) +
            "\n```",
        ),
      );
      const scripted = await withModel(model);
      try {
        const list = events((await run({ campaignId: CAMPAIGN, ...PERIOD }, scripted)).payload);
        const interpretation = (list.find((e) => e.type === "interpretation") as Extract<InvestigationEvent, { type: "interpretation" }>).interpretation;
        assert.equal(interpretation.summary, "Cost per trial moved.");
        assert.deepEqual(interpretation.findings.map((f) => f.title), ["Cost per trial changed", "Paywall release"]);
        assert.deepEqual(interpretation.findings[0]!.evidence, ["metric:cost_per_trial"]);
        assert.deepEqual(interpretation.releaseNotes, [{ release: "release:ios-3.46.0", relevance: "Shipped mid-period." }]);
        assert.deepEqual(interpretation.nextSteps, ["Check cost per trial again in 4 days."]);
        assert.equal(interpretation.removed, 5);
        assert.deepEqual(list.slice(-1).map((e) => e.type), ["done"]);

        // One call, no tools, with the team's documents and the formatted facts.
        assert.equal(model.requests.length, 1);
        const req = model.requests[0]!;
        assert.deepEqual(req.tools, []);
        assert.equal(req.allowTools, false);
        assert.match(req.system, /CAC \| Spend ÷ subscriptions/);
        assert.match(req.system, /Compare channels within each country first/);
        const facts = req.messages[0]!.content as string;
        assert.match(facts, /metric:cac \| CAC \(spend ÷ subscriptions\)/);
        assert.match(facts, /release:ios-3\.46\.0 \| ios 3\.46\.0/);
      } finally {
        await scripted.close();
      }
    });

    it("retries a malformed reply once, then reports MALFORMED_RESPONSE with the facts intact", async () => {
      const model = new ScriptedModel(() => reply("Sorry, here is my analysis in prose."));
      const scripted = await withModel(model);
      try {
        const list = events((await run({ campaignId: CAMPAIGN, ...PERIOD }, scripted)).payload);
        assert.equal(model.requests.length, 2);
        assert.match(model.requests[1]!.messages.at(-1)!.content as string, /couldn't be used/);
        assert.ok(factsOf(list));
        assert.equal((list.at(-2) as { code: string }).code, "MALFORMED_RESPONSE");
        assert.equal(list.some((e) => e.type === "interpretation"), false);
      } finally {
        await scripted.close();
      }
    });

    it("recovers when the retry is well-formed", async () => {
      const model = new ScriptedModel((step) =>
        reply(step === 1 ? "{oops" : JSON.stringify({ summary: "Nothing explains it.", findings: [] })),
      );
      const scripted = await withModel(model);
      try {
        const list = events((await run({ campaignId: CAMPAIGN, ...PERIOD }, scripted)).payload);
        assert.ok(list.some((e) => e.type === "interpretation"));
        assert.equal(list.some((e) => e.type === "error"), false);
      } finally {
        await scripted.close();
      }
    });

    it("turns provider failures into error events after the facts", async () => {
      const model = new ScriptedModel(() => {
        throw new ModelError("RATE_LIMITED", "The model is rate limited. Try again in about 20 s.", 20, "provider detail");
      });
      const scripted = await withModel(model);
      try {
        const list = events((await run({ campaignId: CAMPAIGN, ...PERIOD }, scripted)).payload);
        assert.deepEqual(list.slice(-4).map((e) => e.type), ["facts", "stage", "error", "done"]);
        const error = list.at(-2) as Extract<InvestigationEvent, { type: "error" }>;
        assert.equal(error.code, "RATE_LIMITED");
        assert.equal(error.retryAfterSeconds, 20);
        assert.doesNotMatch(JSON.stringify(list), /provider detail/);
      } finally {
        await scripted.close();
      }
    });
  });
});

describe("empty data", () => {
  it("reports insufficient data and doesn't call the model", async () => {
    const empty = row({});
    const metrics = {
      firstDataDate: "2026-09-03",
      lastDataDate: "2026-10-14",
      today: "2026-10-15",
      lastFinalDate: () => "2026-10-11",
      query: async () => ({ range: PERIOD, groupBy: [], rows: [], totals: empty }),
    } as unknown as MetricsService;
    const model = new ScriptedModel(() => reply("{}"));
    const service = new InvestigationService({
      metrics,
      entities: { campaign: async () => ({ id: "c_1", name: "Empty", channel: "meta", country: "US", status: "paused" }) } as never,
      releases: { list: () => [] } as never,
      knowledge: { glossary: "", teamNotes: "" } as never,
      rules: { active: () => [] } as never,
      model,
      log: { warn: () => {}, error: () => {} },
    });
    const input = await service.validate({ campaignId: "c_1", ...PERIOD });
    const list: InvestigationEvent[] = [];
    for await (const e of service.run(input, { model: "deepseek/deepseek-v4.1-flash" })) list.push(e);

    const facts = factsOf(list) as InvestigationFacts;
    assert.equal(facts.status, "insufficient");
    assert.match(facts.overview, /no spend in either period/);
    assert.equal(facts.drivers.available, false);
    assert.ok(facts.metrics.filter((m) => m.unit !== "count" && m.key !== "spend" && m.key !== "d7_revenue").every((m) => m.current === null));
    assert.equal(model.requests.length, 0);
    assert.ok(list.some((e) => e.type === "stage" && e.key === "interpret" && e.status === "skipped"));
    assert.equal(list.at(-1)!.type, "done");
  });

  it("drops a whole interpretation's figures when the facts are empty", () => {
    const facts = { metrics: [], drivers: { available: false, reason: "" }, adsets: { rows: [], total: 0 }, ads: { rows: [], total: 0 }, releases: [], overview: "Fallback." } as unknown as InvestigationFacts;
    const out = sanitizeInterpretation({ summary: "CAC is $12.00.", findings: [] }, facts);
    assert.equal(out.summary, "Fallback.");
    assert.equal(out.removed, 1);
  });
});
