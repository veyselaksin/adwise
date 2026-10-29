import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { type GeneratedImage, type ImageClient, ImageError, type ImageRequest, ZenMuxImageClient } from "../src/clients/image.client.js";
import { ModelError } from "../src/clients/zenmux.client.js";
import { IMAGE_PROMPT_SUFFIX } from "../src/constants/creatives.constant.js";
import { sniffImage } from "../src/lib/image-bytes.js";
import { clipSentences, parseConcepts, sanitizeConcepts } from "../src/services/creatives.guard.js";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import type { BriefSuggestResult, ConceptsResult, CreativeContext, CreativeView } from "../src/types/creatives.type.js";
import { testEnv } from "./helpers.js";

type App = Awaited<ReturnType<typeof buildApp>>;

const usage = { inputTokens: 1200, outputTokens: 800 };

/** Replays fixed replies (or throws) and records every request. */
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

/** A minimal PNG: signature and an IHDR saying 1024×1024. Enough for the byte checks. */
const png = (width = 1024, height = 1024) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};

/** An image provider that answers from a script, optionally after a delay, and records requests. */
class ScriptedImage implements ImageClient {
  readonly provider = "zenmux";
  readonly requests: ImageRequest[] = [];
  constructor(
    private readonly script: (n: number) => GeneratedImage | ImageError = () => generated(),
    private readonly delayMs = 0,
  ) {}
  async generate(req: ImageRequest): Promise<GeneratedImage> {
    this.requests.push(req);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const out = this.script(this.requests.length);
    if (out instanceof ImageError) throw out;
    return out;
  }
}
const generated = (patch: Partial<GeneratedImage> = {}): GeneratedImage => ({
  ...sniffImage(png())!,
  bytes: png(),
  attempts: 1,
  providerRequestId: "req_1",
  providerCost: null,
  ...patch,
});

const concept = (patch: Record<string, unknown> = {}) => ({
  title: "Morning routine",
  creativeRationale: "CTR held up against the previous period, so the hook works; the test is whether the promise matches the trial.",
  targetAudience: "People starting a habit (assumption)",
  coreMessage: "Start small",
  visualDescription: "A phone on a kitchen counter at sunrise",
  composition: "Phone in the left third, space on the right",
  suggestedHeadline: "Start small. Keep going.",
  suggestedPrimaryText: "One habit at a time, with a free trial.",
  suggestedCallToAction: "Start free trial",
  imagePrompt: "Photorealistic close-up of a smartphone leaning on a coffee mug on a kitchen counter at sunrise, warm light",
  aspectRatio: "1:1",
  performanceEvidence: [{ evidenceId: "metric:ctr", observation: "CTR is reported for the period." }],
  assumptions: ["The audience responds to routine imagery."],
  testHypothesis: "If the image shows the app in a real routine, CTR may hold while cost per trial falls; test against the current ads.",
  ...patch,
});
const conceptsReply = (n = 3, patch: Record<string, unknown> = {}) =>
  JSON.stringify({ concepts: Array.from({ length: n }, (_, i) => concept({ title: `Concept ${i + 1}`, ...patch })) });

const SOURCE = { campaignId: "c_101", from: "2026-10-01", to: "2026-10-07" };
/** A paused ad whose last day is Sep 15: no delivery in October. */
const IDLE_AD = { campaignId: "c_201", adsetId: "as_2011", adId: "ad_3033", from: "2026-10-01", to: "2026-10-07" };

const body = (patch: Record<string, unknown> = {}) => {
  const { conceptId: _, ...c } = { conceptId: "", ...concept() };
  void _;
  return {
    idempotencyKey: randomUUID(),
    concept: c,
    copy: { headline: "Start small. Keep going.", primaryText: "One habit at a time.", callToAction: "Start free trial" },
    imagePrompt: c.imagePrompt,
    aspectRatio: "1:1",
    source: SOURCE,
    ...patch,
  };
};

const SECRET = "zm-test-image-key-0123456789abcdef";

/** One app per test group, with its own files; tokens for two accounts. */
async function setup(opts: { model?: ModelClient; image?: ImageClient | null; env?: Record<string, string>; logs?: string[] } = {}) {
  const env = testEnv({
    CREATIVES_PATH: join(tmpdir(), `adwise-creatives-${randomUUID()}.json`),
    CREATIVE_ASSETS_DIR: join(tmpdir(), `adwise-creative-assets-${randomUUID()}`),
    ...(opts.logs && { LOG_LEVEL: "info" }),
    ...opts.env,
  });
  const logger = opts.logs ? { logger: { stream: { write: (line: string) => void opts.logs!.push(line) } } } : {};
  const app = await buildApp(env, logger, { model: opts.model, image: opts.image });
  const token = app.jwt.sign({ sub: "marketing" });
  const other = app.jwt.sign({ sub: "someone-else" });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, as: string | null = token) =>
    app.inject({ method, url, ...(payload && { payload }), headers: as ? { authorization: `Bearer ${as}` } : {} });
  return { app, env, token, other, call };
}

describe("creative studio: context", () => {
  let app: App;
  let call: Awaited<ReturnType<typeof setup>>["call"];
  before(async () => ({ app, call } = await setup({ image: null })));
  after(() => app.close());

  it("reads the campaign's real numbers from the metric layer", async () => {
    const res = await call("GET", `/creatives/context?${new URLSearchParams(SOURCE)}`);
    assert.equal(res.statusCode, 200);
    const ctx = res.json().data as CreativeContext;
    const truth = await app.services.metrics.query({ range: { from: SOURCE.from, to: SOURCE.to }, filters: { campaignIds: ["c_101"] } });
    const prev = await app.services.metrics.query({ range: { from: "2026-09-24", to: "2026-09-30" }, filters: { campaignIds: ["c_101"] } });
    const m = (key: string) => ctx.metrics.find((x) => x.key === key)!;

    assert.equal(ctx.status, "ok");
    assert.equal(ctx.campaign.name, "LIV_META_US_Subs");
    assert.equal(m("spend").current, truth.totals.spend);
    assert.equal(m("cac").current, truth.totals.cac);
    assert.equal(m("ctr").current, truth.totals.ctr);
    assert.equal(m("cpc").current, truth.totals.spend / truth.totals.clicks);
    assert.equal(m("cac").previous, prev.totals.cac);
    assert.deepEqual(ctx.comparison, { available: true, range: { from: "2026-09-24", to: "2026-09-30" } });
    assert.equal(m("spend").kind, "observed");
    assert.equal(m("cac").kind, "calculated");
    assert.equal(m("cpc").inGlossary, false);
    assert.ok(ctx.topAds.length > 0 && ctx.topAds.every((a) => a.adsetName && a.creativeType));
    assert.ok(ctx.unavailable.some((u) => u.label === "Audience demographics"));
  });

  it("returns nulls, not zeros or guesses, when there's no delivery", async () => {
    const res = await call("GET", `/creatives/context?${new URLSearchParams(IDLE_AD)}`);
    assert.equal(res.statusCode, 200);
    const ctx = res.json().data as CreativeContext;
    assert.equal(ctx.level, "ad");
    assert.equal(ctx.status, "insufficient");
    assert.match(ctx.statusReason!, /No spend/);
    for (const key of ["ctr", "cpc", "cpi", "cac", "cost_per_trial", "trial_to_sub", "d7_roas"]) {
      assert.equal(ctx.metrics.find((m) => m.key === key)!.current, null, key);
    }
    assert.equal(ctx.metrics.find((m) => m.key === "spend")!.current, 0);
  });

  it("marks the comparison unavailable when the previous period is before the data", async () => {
    const ctx = (await call("GET", `/creatives/context?${new URLSearchParams({ campaignId: "c_101", from: "2026-09-03", to: "2026-09-09" })}`)).json().data as CreativeContext;
    assert.equal(ctx.comparison.available, false);
    assert.ok(ctx.metrics.every((m) => m.previous === null && m.pctChange === null));
  });

  it("validates ids, hierarchy and dates", async () => {
    const q = (p: Record<string, string>) => call("GET", `/creatives/context?${new URLSearchParams({ ...SOURCE, ...p })}`);
    assert.equal((await q({ campaignId: "c_999" })).json().error.code, "CAMPAIGN_NOT_FOUND");
    assert.equal((await q({ adsetId: "as_2011" })).json().error.code, "ADSET_NOT_FOUND");
    assert.equal((await q({ adId: "ad_3033" })).json().error.code, "ADSET_REQUIRED");
    assert.equal((await q({ from: "2026-12-01", to: "2026-12-02" })).json().error.code, "RANGE_OUTSIDE_DATA");
    assert.equal((await q({ campaignId: "c_101' OR 1=1" })).statusCode, 400);
  });
});

describe("creative studio: concepts", () => {
  it("sends the model the campaign's real figures and keeps cited evidence", async () => {
    const model = new ScriptedModel(() => reply(conceptsReply(3)));
    const { app, call } = await setup({ model, image: null });
    try {
      const res = await call("POST", "/creatives/concepts", { source: SOURCE, brief: { targetAudience: "Busy parents" } });
      assert.equal(res.statusCode, 200);
      const data = res.json().data as ConceptsResult;
      assert.equal(data.dataInformed, true);
      assert.equal(data.concepts.length, 3);
      assert.ok(data.concepts.every((c) => /^cn_[0-9a-f]{8}$/.test(c.conceptId)));
      assert.equal(data.concepts[0]!.performanceEvidence[0]!.label, "CTR");

      const truth = await app.services.metrics.query({ range: { from: SOURCE.from, to: SOURCE.to }, filters: { campaignIds: ["c_101"] } });
      const sent = model.requests[0]!.messages[0]!.content as string;
      const spend = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(truth.totals.spend);
      assert.ok(sent.includes(spend), "the campaign's spend reaches the model as measured");
      assert.ok(sent.includes("LIV_META_US_Subs"));
      assert.ok(sent.includes("Busy parents"));
      assert.match(model.requests[0]!.system, /Never invent metrics/);
    } finally {
      await app.close();
    }
  });

  it("strips evidence and figures that aren't in the data", async () => {
    const model = new ScriptedModel(() =>
      reply(
        conceptsReply(2, {
          creativeRationale: "CTR is up 412.7% thanks to this hook. The visual should feel calm.",
          performanceEvidence: [
            { evidenceId: "metric:ctr", observation: "CTR is reported." },
            { evidenceId: "metric:made_up", observation: "Invented." },
          ],
        }),
      ),
    );
    const { app, call } = await setup({ model, image: null });
    try {
      const data = (await call("POST", "/creatives/concepts", { source: SOURCE })).json().data as ConceptsResult;
      const c = data.concepts[0]!;
      assert.equal(c.creativeRationale, "The visual should feel calm.");
      assert.deepEqual(c.performanceEvidence.map((e) => e.evidenceId), ["metric:ctr"]);
      assert.equal(data.removed, 4);
    } finally {
      await app.close();
    }
  });

  it("labels concepts exploratory and drops evidence without usable data", async () => {
    const model = new ScriptedModel(() => reply(conceptsReply(2)));
    const { app, call } = await setup({ model, image: null });
    try {
      for (const payload of [{ source: IDLE_AD }, { brief: { productContext: "A habit app" } }]) {
        const data = (await call("POST", "/creatives/concepts", payload)).json().data as ConceptsResult;
        assert.equal(data.dataInformed, false);
        assert.ok(data.exploratoryReason);
        assert.ok(data.concepts.every((c) => c.performanceEvidence.length === 0));
      }
      const idle = model.requests[0]!.messages[0]!.content as string;
      assert.doesNotMatch(idle, /# Measured performance/, "no metrics are offered for an entity without delivery");
      assert.match(model.requests[0]!.system, /EXPLORATORY/);
      assert.match(model.requests[1]!.messages[0]!.content as string, /No campaign was selected/);
    } finally {
      await app.close();
    }
  });

  it("retries a malformed reply once, then fails cleanly", async () => {
    const flaky = new ScriptedModel((n) => reply(n === 1 ? "Sure! Here are some ideas…" : conceptsReply(2)));
    const ok = await setup({ model: flaky, image: null });
    const broken = new ScriptedModel(() => reply(JSON.stringify({ concepts: [{ title: "Only a title" }] })));
    const bad = await setup({ model: broken, image: null });
    try {
      const res = await ok.call("POST", "/creatives/concepts", { source: SOURCE });
      assert.equal(res.statusCode, 200);
      assert.equal(flaky.requests.length, 2);

      const failed = await bad.call("POST", "/creatives/concepts", { source: SOURCE });
      assert.equal(failed.statusCode, 502);
      assert.equal(failed.json().error.code, "MALFORMED_RESPONSE");
      assert.equal(broken.requests.length, 2);
    } finally {
      await ok.app.close();
      await bad.app.close();
    }
  });

  it("parses fenced JSON and rejects too few or invalid concepts", () => {
    assert.equal(parseConcepts("```json\n" + conceptsReply(2) + "\n```").ok, true);
    assert.equal(parseConcepts("{ not json").ok, false);
    assert.equal(parseConcepts(JSON.stringify({ concepts: [] })).ok, false);
    const raw = parseConcepts(conceptsReply(2, { aspectRatio: "4:5", title: "x".repeat(300) }));
    assert.ok(raw.ok);
    const { concepts } = sanitizeConcepts(raw.value, null, { dataInformed: false, fallbackRatio: "16:9" });
    assert.equal(concepts[0]!.aspectRatio, "16:9", "an unsupported ratio falls back");
    assert.equal(concepts[0]!.title.length, 80);
  });

  it("reports model failures with stable codes and AGENT_DISABLED without a key", async () => {
    const model = new ScriptedModel(() => {
      throw new ModelError("RATE_LIMITED", "The model is rate limited. Try again in about 5 s.", 5, "provider says slow down");
    });
    const limited = await setup({ model, image: null });
    const off = await setup({ image: null });
    try {
      const res = await limited.call("POST", "/creatives/concepts", { source: SOURCE });
      assert.equal(res.statusCode, 429);
      assert.equal(res.json().error.code, "RATE_LIMITED");
      assert.doesNotMatch(res.payload, /provider says/);
      assert.equal((await off.call("POST", "/creatives/concepts", { source: SOURCE })).json().error.code, "AGENT_DISABLED");
    } finally {
      await limited.app.close();
      await off.app.close();
    }
  });
});

describe("creative studio: brief suggestions", () => {
  const suggestion = (field: string, value: string, basis = "data", note = "From the ad set names.") => ({ field, value, basis, note });

  it("suggests only the empty fields, from the selection's real data", async () => {
    const model = new ScriptedModel(() =>
      reply(
        JSON.stringify({
          suggestions: [
            suggestion("productContext", "Livensa subscription campaign on Meta in the US."),
            suggestion("targetAudience", "Should not appear: the user wrote this one."),
            suggestion("desiredMessage", "Set clear expectations for the free trial.", "assumption", "Clicks held up while conversion fell."),
            suggestion("slogan", "Not a brief field."),
          ],
        }),
      ),
    );
    const { app, call } = await setup({ model, image: null });
    try {
      const res = await call("POST", "/creatives/brief-suggestions", { source: SOURCE, brief: { targetAudience: "Busy parents" } });
      assert.equal(res.statusCode, 200);
      const data = res.json().data as BriefSuggestResult;
      assert.deepEqual(data.suggestions.map((s) => s.field), ["productContext", "desiredMessage"]);
      assert.equal(data.suggestions[1]!.basis, "assumption");
      assert.equal(data.removed, 2);
      assert.equal(data.dataInformed, true);

      const sent = model.requests[0]!.messages[0]!.content as string;
      assert.ok(sent.includes("LIV_META_US_Subs"), "the real campaign reaches the model");
      assert.ok(sent.includes("# Measured performance"));
      assert.match(sent, /Already written by the user[\s\S]*Busy parents/);
      assert.doesNotMatch(sent.slice(sent.indexOf("# Empty fields")), /targetAudience/, "a filled field isn't asked for");
      assert.match(model.requests[0]!.system, /never state any as fact/);

      const runs = (await call("GET", "/observability/runs?range=1h&kind=creative_brief")).json().data.runs as { status: string }[];
      assert.deepEqual(runs.map((r) => r.status), ["success"]);
    } finally {
      await app.close();
    }
  });

  it("carries no figures, and is assumption-only without usable data", async () => {
    const model = new ScriptedModel(() =>
      reply(
        JSON.stringify({
          suggestions: [
            suggestion("desiredMessage", "CAC is up 72.2%, so fix it. Lead with how the trial works."),
            suggestion("constraints", "Offer $9.99 a month."),
            suggestion("brandVoice", "Warm and plain-spoken.", "weird-basis", ""),
          ],
        }),
      ),
    );
    const { app, call } = await setup({ model, image: null });
    try {
      const data = (await call("POST", "/creatives/brief-suggestions", { source: IDLE_AD })).json().data as BriefSuggestResult;
      assert.equal(data.dataInformed, false);
      assert.deepEqual(
        data.suggestions.map((s) => [s.field, s.value]),
        [
          ["desiredMessage", "Lead with how the trial works."],
          ["brandVoice", "Warm and plain-spoken."],
        ],
      );
      assert.equal(data.suggestions[1]!.basis, "assumption", "an unknown basis is an assumption");
      assert.ok(data.suggestions[1]!.note);
      assert.doesNotMatch(model.requests[0]!.messages[0]!.content as string, /# Measured performance/);
    } finally {
      await app.close();
    }
  });

  it("trims long suggestions at a sentence boundary", () => {
    assert.equal(clipSentences("First one. Second one is longer. Third.", 30), "First one.");
    assert.equal(clipSentences("Short. Fine.", 30), "Short. Fine.");
    assert.equal(clipSentences("x".repeat(50), 10), `${"x".repeat(9)}…`);
  });

  it("validates input, refuses a full brief, and needs a token and a key", async () => {
    const model = new ScriptedModel(() => reply(JSON.stringify({ suggestions: [] })));
    const { app, call } = await setup({ model, image: null });
    const off = await setup({ image: null });
    try {
      const full = Object.fromEntries(["productContext", "targetAudience", "desiredMessage", "brandVoice", "visualPreferences", "constraints"].map((k) => [k, "x"]));
      assert.equal((await call("POST", "/creatives/brief-suggestions", { brief: full })).json().error.code, "BRIEF_COMPLETE");
      assert.equal((await call("POST", "/creatives/brief-suggestions", { brief: { productContext: "x".repeat(601) } })).statusCode, 400);
      assert.equal((await call("POST", "/creatives/brief-suggestions", { source: { ...SOURCE, campaignId: "c_nope" } })).statusCode, 404);
      assert.equal((await call("POST", "/creatives/brief-suggestions", {}, null)).statusCode, 401);
      assert.equal(model.requests.length, 0, "no model call for a rejected request");
      assert.equal((await off.call("POST", "/creatives/brief-suggestions", {})).json().error.code, "AGENT_DISABLED");
      assert.equal((await call("POST", "/creatives/brief-suggestions", {})).statusCode, 200);
    } finally {
      await app.close();
      await off.app.close();
    }
  });
});

describe("creative studio: images", () => {
  it("needs server-side credentials and valid input", async () => {
    const off = await setup({ image: null });
    const on = await setup({ image: new ScriptedImage() });
    try {
      const config = (await off.call("GET", "/creatives/config")).json().data;
      assert.equal(config.image.enabled, false);
      assert.match(config.image.disabledReason, /IMAGE_API_KEY/);
      const res = await off.call("POST", "/creatives", body());
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error.code, "IMAGE_DISABLED");

      for (const bad of [
        body({ idempotencyKey: "not-a-uuid" }),
        body({ imagePrompt: "short" }),
        body({ imagePrompt: "x".repeat(1501) }),
        body({ aspectRatio: "4:5" }),
        { ...body(), copy: { headline: "", primaryText: "x", callToAction: "x" } },
      ]) {
        const r = await on.call("POST", "/creatives", bad);
        assert.equal(r.statusCode, 400, JSON.stringify(bad).slice(0, 80));
        assert.equal(r.json().error.code, "VALIDATION_ERROR");
      }
    } finally {
      await off.app.close();
      await on.app.close();
    }
  });

  it("generates, stores and serves an image with its context, without a cost guess", async () => {
    const image = new ScriptedImage();
    const { app, env, call } = await setup({ image });
    try {
      const res = await call("POST", "/creatives", body());
      assert.equal(res.statusCode, 200);
      const creative = res.json().data.creatives[0] as CreativeView;
      assert.equal(creative.status, "succeeded");
      assert.equal(creative.dataInformed, true);
      assert.equal(creative.sourceLabel!.campaign, "LIV_META_US_Subs");
      assert.deepEqual(creative.image, { mimeType: "image/png", bytes: 64, width: 1024, height: 1024 });
      assert.deepEqual(creative.cost.usd, null);
      assert.equal(creative.cost.status, "unavailable");
      assert.equal(creative.modelLabel, "Kling v3");
      assert.ok(creative.runId);
      const spend = creative.metricsSnapshot!.metrics.find((m) => m.key === "spend")!.value;
      const truth = await app.services.metrics.query({ range: { from: SOURCE.from, to: SOURCE.to }, filters: { campaignIds: ["c_101"] } });
      assert.equal(spend, truth.totals.spend);
      assert.ok(!("idempotencyKey" in creative), "the key stays on the server");
      assert.ok(!JSON.stringify(creative).includes(env.CREATIVE_ASSETS_DIR), "no storage path in responses");

      assert.equal(image.requests[0]!.prompt, `${body().imagePrompt}\n\n${IMAGE_PROMPT_SUFFIX}`);
      assert.equal(image.requests[0]!.model, "klingai/kling-v3");

      const file = await call("GET", `/creatives/${creative.id}/image?download=true`);
      assert.equal(file.statusCode, 200);
      assert.equal(file.headers["content-type"], "image/png");
      assert.match(String(file.headers["content-disposition"]), /^attachment; filename="adwise-morning-routine\.png"/);
      assert.equal(file.headers["cache-control"], "private, no-store");
      assert.deepEqual(file.rawPayload, png());

      const run = (await call("GET", `/observability/runs/${creative.runId}`)).json().data;
      assert.equal(run.run.kind, "creative_image");
      assert.equal(run.run.status, "success");
      assert.equal(run.run.estimatedCost, null);
      assert.ok(run.spans.some((s: { name: string; kind: string }) => s.kind === "model" && s.name === "Generate image"));
    } finally {
      await app.close();
    }
  });

  it("re-checks evidence the browser sends back", async () => {
    const { app, call } = await setup({ image: new ScriptedImage() });
    try {
      const forged = body({
        concept: { ...body().concept, performanceEvidence: [{ evidenceId: "metric:cac", label: "CAC", observation: "CAC fell 93.3% because of this ad." }, { evidenceId: "metric:nope", label: "x", observation: "x" }] },
      });
      const data = (await call("POST", "/creatives", forged)).json().data.creatives[0] as CreativeView;
      assert.deepEqual(data.concept.performanceEvidence, []);
      const exploratory = (await call("POST", "/creatives", body({ source: undefined }))).json().data.creatives[0] as CreativeView;
      assert.equal(exploratory.dataInformed, false);
      assert.equal(exploratory.metricsSnapshot, null);
      assert.deepEqual(exploratory.concept.performanceEvidence, []);
    } finally {
      await app.close();
    }
  });

  it("records provider failures as failed creatives with stable codes", async () => {
    const image = new ScriptedImage(() => new ImageError("IMAGE_TIMEOUT", "The image took too long to generate.", { attempts: 1, detail: "upstream internals" }));
    const { app, call } = await setup({ image });
    try {
      const res = await call("POST", "/creatives", body());
      assert.equal(res.statusCode, 504);
      assert.equal(res.json().error.code, "IMAGE_TIMEOUT");
      assert.doesNotMatch(res.payload, /upstream internals/);
      const list = (await call("GET", "/creatives?status=failed")).json().data;
      assert.equal(list.total, 1);
      assert.equal(list.items[0].error.code, "IMAGE_TIMEOUT");
      assert.equal(list.items[0].image, null);
      const runs = (await call("GET", "/observability/runs?range=1h&kind=creative_image")).json().data;
      assert.equal(runs.runs[0].status, "timeout");
      assert.equal(image.requests.length, 1, "a paid request is never retried automatically");
    } finally {
      await app.close();
    }
  });

  it("controls repeated submissions: idempotency, one at a time, a daily limit", async () => {
    const image = new ScriptedImage(() => generated(), 150);
    const { app, call } = await setup({ image, env: { IMAGE_DAILY_LIMIT: "2" } });
    try {
      const first = body();
      const [a, b] = await Promise.all([call("POST", "/creatives", first), call("POST", "/creatives", body())]);
      assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
      assert.equal((a.statusCode === 409 ? a : b).json().error.code, "GENERATION_IN_PROGRESS");

      const again = await call("POST", "/creatives", first);
      if (a.statusCode === 200) {
        assert.equal(again.statusCode, 200);
        assert.equal(again.json().data.creatives[0].id, a.json().data.creatives[0].id);
        assert.equal(again.json().data.replayed, true);
        assert.match(again.json().message, /no new image/);
      }
      const requestsSoFar = image.requests.length;
      assert.equal(requestsSoFar, 1);

      assert.equal((await call("POST", "/creatives", body())).statusCode, 200);
      const limited = await call("POST", "/creatives", body());
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error.code, "DAILY_LIMIT_REACHED");
      assert.equal(image.requests.length, 2);
      assert.equal((await call("GET", "/creatives/config")).json().data.image.usedToday, 2);
    } finally {
      await app.close();
    }
  });
});

describe("creative studio: several images per request", () => {
  it("makes each image its own creative, side by side, and counts each against the limits", async () => {
    const image = new ScriptedImage(() => generated(), 100);
    const { app, call } = await setup({ image, env: { IMAGE_DAILY_LIMIT: "4" } });
    try {
      const first = body({ count: 3 });
      const started = Date.now();
      const res = await call("POST", "/creatives", first);
      assert.equal(res.statusCode, 200);
      assert.ok(Date.now() - started < 290, "the images run in parallel");
      const data = res.json().data as { creatives: CreativeView[]; requested: number; replayed: boolean };
      assert.equal(data.requested, 3);
      assert.equal(new Set(data.creatives.map((c) => c.id)).size, 3);
      assert.deepEqual(data.creatives.map((c) => c.title), ["Morning routine (1/3)", "Morning routine (2/3)", "Morning routine (3/3)"]);
      assert.ok(data.creatives.every((c) => c.status === "succeeded" && c.runId === data.creatives[0]!.runId));
      assert.equal(res.json().message, "3 images generated");
      assert.equal(image.requests.length, 3);

      const again = (await call("POST", "/creatives", first)).json().data;
      assert.equal(again.replayed, true);
      assert.equal(again.creatives.length, 3);
      assert.equal(image.requests.length, 3, "a resent batch requests nothing new");

      const over = await call("POST", "/creatives", body({ count: 2 }));
      assert.equal(over.statusCode, 429);
      assert.equal(over.json().error.code, "DAILY_LIMIT_REACHED");
      assert.match(over.json().message, /Only 1 of the team's 4/);
      assert.equal(image.requests.length, 3);
      assert.equal((await call("GET", "/creatives/config")).json().data.image.countMax, 3);
      for (const count of [0, 4]) assert.equal((await call("POST", "/creatives", body({ count }))).statusCode, 400, `count ${count}`);
    } finally {
      await app.close();
    }
  });

  it("keeps the images that succeeded when others fail", async () => {
    const image = new ScriptedImage((n) => (n === 2 ? new ImageError("IMAGE_REJECTED", "The provider refused this prompt.", { attempts: 1, detail: "secret internals" }) : generated()));
    const { app, call } = await setup({ image });
    try {
      const res = await call("POST", "/creatives", body({ count: 3 }));
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().message, "2 of 3 images generated; the rest failed");
      assert.doesNotMatch(res.payload, /secret internals/);
      const statuses = (res.json().data.creatives as CreativeView[]).map((c) => c.status).sort();
      assert.deepEqual(statuses, ["failed", "succeeded", "succeeded"]);
      assert.equal((await call("GET", "/creatives?status=failed")).json().data.total, 1);
      const runs = (await call("GET", "/observability/runs?range=1h&kind=creative_image")).json().data.runs;
      assert.equal(runs[0].status, "failure");
    } finally {
      await app.close();
    }
  });
});

describe("creative studio: library and access", () => {
  let app: App;
  let env: ReturnType<typeof testEnv>;
  let call: Awaited<ReturnType<typeof setup>>["call"];
  let other: string;
  let saved: CreativeView;

  before(async () => {
    ({ app, env, call, other } = await setup({ image: new ScriptedImage() }));
    saved = (await call("POST", "/creatives", body({ title: "Sunrise kitchen" }))).json().data.creatives[0];
  });
  after(() => app.close());

  it("needs a token on every route", async () => {
    const id = saved.id;
    for (const [method, url, payload] of [
      ["GET", "/creatives/config"],
      ["GET", `/creatives/context?${new URLSearchParams(SOURCE)}`],
      ["POST", "/creatives/concepts", { source: SOURCE }],
      ["POST", "/creatives", body()],
      ["GET", "/creatives"],
      ["GET", `/creatives/${id}`],
      ["GET", `/creatives/${id}/image`],
      ["PATCH", `/creatives/${id}`, { title: "x" }],
      ["DELETE", `/creatives/${id}`],
    ] as const) {
      const res = await call(method, url, payload, null);
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
  });

  it("hides one account's creatives from another", async () => {
    assert.equal((await call("GET", "/creatives", undefined, other)).json().data.total, 0);
    for (const [method, url, payload] of [
      ["GET", `/creatives/${saved.id}`],
      ["GET", `/creatives/${saved.id}/image`],
      ["PATCH", `/creatives/${saved.id}`, { title: "Mine now" }],
      ["DELETE", `/creatives/${saved.id}`],
    ] as const) {
      const res = await call(method, url, payload, other);
      assert.equal(res.statusCode, 404, `${method} ${url}`);
      assert.equal(res.json().error.code, "CREATIVE_NOT_FOUND");
    }
    const variation = await call("POST", "/creatives", body({ parentId: saved.id }), other);
    assert.equal(variation.json().error.code, "CREATIVE_NOT_FOUND");
  });

  it("lists, filters, edits copy and survives a restart", async () => {
    const list = (await call("GET", "/creatives?q=sunrise&basis=data")).json().data;
    assert.equal(list.total, 1);
    assert.equal(list.items[0].headline, "Start small. Keep going.");
    assert.equal((await call("GET", "/creatives?basis=exploratory")).json().data.total, 0);
    assert.equal((await call("GET", "/creatives?limit=500")).statusCode, 400);

    const edited = await call("PATCH", `/creatives/${saved.id}`, { copy: { headline: "Two minutes a day" } });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().data.copy.headline, "Two minutes a day");
    assert.equal(edited.json().data.copy.callToAction, "Start free trial");
    assert.equal((await call("PATCH", `/creatives/${saved.id}`, {})).statusCode, 400);

    const variation = (await call("POST", "/creatives", body({ parentId: saved.id }))).json().data.creatives[0] as CreativeView;
    assert.equal(variation.parentId, saved.id);

    const reopened = await buildApp(env, {}, { image: new ScriptedImage() });
    try {
      const token = reopened.jwt.sign({ sub: "marketing" });
      const res = await reopened.inject({ method: "GET", url: `/creatives/${saved.id}`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(res.json().data.copy.headline, "Two minutes a day");
      const img = await reopened.inject({ method: "GET", url: `/creatives/${saved.id}/image`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(img.statusCode, 200);
    } finally {
      await reopened.close();
    }
  });

  it("deletes the record and its file", async () => {
    const created = (await call("POST", "/creatives", body())).json().data.creatives[0] as CreativeView;
    const file = join(env.CREATIVE_ASSETS_DIR, `${created.id}.png`);
    assert.ok(existsSync(file));
    assert.equal((await call("DELETE", `/creatives/${created.id}`)).statusCode, 200);
    assert.equal(existsSync(file), false);
    assert.equal((await call("GET", `/creatives/${created.id}`)).statusCode, 404);
  });
});

describe("ZenMux image client", () => {
  const CDN = "https://s15-kling-fdl.klingai.com/bs2/upload/IMAGE/abc.png?Signature=x";

  /** Answers each fetch from the list in order and records what was asked. */
  const fakeFetch = (responses: (() => Response)[]) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fn = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return next();
    }) as typeof fetch;
    return { fn, calls };
  };
  const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => () =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
  const client = (fn: typeof fetch) => new ZenMuxImageClient({ apiKey: SECRET, fetch: fn, sleep: async () => undefined });
  const request = { model: "klingai/kling-v3", prompt: "A kitchen at sunrise", aspectRatio: "16:9" } as const;

  it("calls the Vertex predict endpoint and downloads the image from Kling's CDN", async () => {
    const { fn, calls } = fakeFetch([json(200, { predictions: [{ gcsUri: CDN }] }, { "x-zenmux-requestid": "zr_1" }), () => new Response(png(1536, 1024))]);
    const out = await client(fn).generate(request);
    assert.equal(calls[0]!.url, "https://zenmux.ai/api/vertex-ai/v1/publishers/klingai/models/kling-v3:predict");
    assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { instances: [{ prompt: "A kitchen at sunrise" }], parameters: { sampleCount: 1, aspectRatio: "16:9" } });
    assert.equal(calls[1]!.url, CDN);
    assert.equal(new Headers(calls[1]!.init?.headers).get("authorization"), null, "the key never goes to the CDN");
    assert.deepEqual([out.width, out.height, out.mimeType, out.providerRequestId, out.providerCost], [1536, 1024, "image/png", "zr_1", null]);
  });

  it("refuses links outside the provider's storage and files that aren't images", async () => {
    for (const uri of ["https://evil.example.com/a.png", "http://s15.klingai.com/a.png", "https://klingai.com.evil.io/a.png", "file:///etc/passwd"]) {
      const { fn, calls } = fakeFetch([json(200, { predictions: [{ gcsUri: uri }] })]);
      await assert.rejects(client(fn).generate(request), (e: ImageError) => e.code === "IMAGE_BAD_OUTPUT", uri);
      assert.equal(calls.length, 1, `${uri} was not fetched`);
    }
    const { fn } = fakeFetch([json(200, { predictions: [{ gcsUri: CDN }] }), () => new Response("<html>not an image</html>")]);
    await assert.rejects(client(fn).generate(request), (e: ImageError) => e.code === "IMAGE_BAD_OUTPUT");
    const blocked = fakeFetch([json(200, { predictions: [{ raiFilteredReason: "policy" }] })]);
    await assert.rejects(client(blocked.fn).generate(request), (e: ImageError) => e.code === "IMAGE_BLOCKED");
  });

  it("retries only a 429, and never a request that may have been billed", async () => {
    const limited = fakeFetch([json(429, { error: { message: "slow" } }, { "retry-after": "1" }), json(200, { predictions: [{ bytesBase64Encoded: png().toString("base64") }] })]);
    const ok = await client(limited.fn).generate(request);
    assert.equal(ok.attempts, 2);

    const failing = fakeFetch([json(500, { error: { message: "boom" } })]);
    await assert.rejects(client(failing.fn).generate(request), (e: ImageError) => e.code === "IMAGE_UNAVAILABLE" && e.opts.attempts === 1);
    assert.equal(failing.calls.length, 1);

    const quota = fakeFetch([json(402, {})]);
    await assert.rejects(client(quota.fn).generate(request), (e: ImageError) => e.code === "IMAGE_QUOTA_EXHAUSTED");
    await assert.rejects(client(fakeFetch([]).fn).generate({ ...request, aspectRatio: "4:5" as "1:1" }), (e: ImageError) => e.code === "IMAGE_REJECTED");
  });

  it("keeps the key out of responses and logs even when the provider echoes it", async () => {
    const logs: string[] = [];
    const { fn } = fakeFetch([json(403, { error: { message: `invalid key ${SECRET}` } })]);
    const { app, call } = await setup({ image: new ZenMuxImageClient({ apiKey: SECRET, fetch: fn }), logs, env: { IMAGE_API_KEY: SECRET } });
    try {
      const res = await call("POST", "/creatives", body());
      assert.equal(res.json().error.code, "IMAGE_REJECTED");
      const config = await call("GET", "/creatives/config");
      const stored = await call("GET", "/observability/logs?range=1h&component=creatives");
      const failed = (await call("GET", "/creatives")).json().data.items[0];
      for (const text of [res.payload, config.payload, stored.payload, JSON.stringify(failed), logs.join("\n")]) {
        assert.ok(!text.includes(SECRET), text.slice(0, 200));
      }
      assert.match(logs.join("\n"), /\[REDACTED\]/, "the provider's echo is scrubbed, not dropped");
    } finally {
      await app.close();
    }
  });
});

describe("image bytes", () => {
  it("recognizes PNG, JPEG and WebP and nothing else", () => {
    assert.deepEqual(sniffImage(png(800, 600)), { mimeType: "image/png", extension: "png", width: 800, height: 600 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01]);
    assert.deepEqual(sniffImage(jpeg), { mimeType: "image/jpeg", extension: "jpg", width: 800, height: 600 });
    assert.equal(sniffImage(Buffer.from("GIF89a……………………………………………")), null);
    assert.equal(sniffImage(Buffer.alloc(0)), null);
  });
});
