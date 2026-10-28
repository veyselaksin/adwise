import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { GeminiClient, ModelError } from "../src/clients/gemini.client.js";
import { AGENT_MAX_STEPS, AGENT_RECENT_MESSAGES } from "../src/constants/agent.constant.js";
import { TOOL_DECLARATIONS } from "../src/services/agent.tools.js";
import { toContents } from "../src/services/agent.service.js";
import { ReleasesService } from "../src/services/releases.service.js";
import type { AgentEvent, ModelClient, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import { CASE_DIR, testEnv } from "./helpers.js";

const usage = { inputTokens: 100, outputTokens: 10 };
const call = (name: string, args: Record<string, unknown>): ModelResponse => ({
  content: { role: "model", parts: [{ functionCall: { name, args } }] },
  usage,
});
const say = (text: string): ModelResponse => ({ content: { role: "model", parts: [{ text }] }, usage });

/**
 * Replays fixed responses, streaming their text in two pieces, and records every
 * request, so tests see exactly what the model was sent.
 */
class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: (step: number, req: ModelRequest) => ModelResponse) {}
  async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    const res = this.script(this.requests.length, req);
    for (const part of res.content.parts) {
      if (!part.text) continue;
      const half = Math.ceil(part.text.length / 2);
      yield part.text.slice(0, half);
      yield part.text.slice(half);
    }
    return res;
  }
}

const events = (payload: string) =>
  payload
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as AgentEvent);

describe("build logs", () => {
  it("parses every release with its commits", async () => {
    const releases = await ReleasesService.load(join(CASE_DIR, "build-logs"));
    const all = releases.list();
    assert.equal(all.length, 12);
    assert.deepEqual(
      all.slice(0, 2).map((r) => [r.platform, r.version, r.date]),
      [
        ["ios", "3.41.0", "2026-09-05"],
        ["android", "3.41.0", "2026-09-08"],
      ],
    );
    const android346 = releases.list({ range: { from: "2026-10-13" } });
    assert.equal(android346.length, 1);
    assert.deepEqual(android346[0]?.commits[1], {
      hash: "1823a69",
      author: "elif.y",
      date: "2026-10-11 06:48",
      type: "perf",
      scope: "render",
      title: "cut average render time by about 20%",
      body: "Batches frame uploads and reuses the model session between clips.\nMedian render time 41s -> 33s in internal tests.",
    });
    assert.equal(releases.list({ platform: "ios", range: { from: "2026-10-01", to: "2026-10-14" } }).length, 2);
  });
});

describe("agent context", () => {
  it("declares tools in Gemini's schema format", () => {
    assert.deepEqual(
      TOOL_DECLARATIONS.map((t) => t.name),
      ["query_metrics", "list_entities", "get_budget_pacing", "get_releases"],
    );
    const params = TOOL_DECLARATIONS[0]!.parameters as { type: string; properties: Record<string, { type: string; items?: { enum?: string[] } }> };
    assert.equal(params.type, "OBJECT");
    assert.equal(params.properties.group_by?.type, "ARRAY");
    assert.ok(params.properties.group_by?.items?.enum?.includes("adset"));
    assert.equal(params.properties.limit?.type, "INTEGER");
  });

  it("keeps recent messages verbatim and shortens older ones", () => {
    const turns = Array.from({ length: 6 }, (_, i) => [
      { role: "user" as const, text: `Question ${i}` },
      { role: "assistant" as const, text: `**Answer ${i} leads.** Then details ${i}.` },
    ]).flat();
    const contents = toContents([...turns, { role: "user", text: "Latest?" }]);

    const digest = contents[0]!.parts[0]!.text!;
    assert.match(digest, /^Earlier in this conversation/);
    assert.match(digest, /Q: Question 0\nA: Answer 0 leads\./);
    assert.doesNotMatch(digest, /details 0/);
    // The digest is the user's turn; the verbatim tail starts with the model's.
    assert.deepEqual(
      contents.map((c) => c.role),
      ["user", "model", "user", "model", "user", "model", "user", "model", "user"],
    );
    assert.equal(contents.length, AGENT_RECENT_MESSAGES + 1);
    assert.equal(contents.at(-1)!.parts[0]!.text, "Latest?");
  });
});

describe("POST /agent/chat", () => {
  let token = "";
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const appWith = async (model?: ModelClient) => {
    const app = await buildApp(testEnv(), {}, { model });
    apps.push(app);
    if (!token) {
      const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
      token = res.json().data.token;
    }
    return app;
  };
  const ask = (app: Awaited<ReturnType<typeof buildApp>>, text: string, auth = true) =>
    app.inject({
      method: "POST",
      url: "/agent/chat",
      headers: auth ? { authorization: `Bearer ${token}` } : {},
      payload: { messages: [{ role: "user", text }] },
    });

  before(() => appWith());
  after(() => Promise.all(apps.map((a) => a.close())));

  it("answers through the same services as the dashboard and streams each step", async () => {
    const answer = "**You spent $61,556.50 last week.**";
    const model = new ScriptedModel((step) =>
      step === 1
        ? call("query_metrics", { preset: "last_week", group_by: ["channel"], metrics: ["spend"] })
        : say(answer),
    );
    const res = await ask(await appWith(model), "How much did we spend last week?");
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] as string, /application\/x-ndjson/);

    assert.deepEqual(events(res.payload), [
      { type: "tool_call", id: "1.1", tool: "query_metrics", label: "spend by channel · last week", args: { preset: "last_week", group_by: ["channel"], metrics: ["spend"] } },
      { type: "tool_result", id: "1.1", ok: true, summary: "2 rows · total spend $61,556.50" },
      { type: "text_delta", text: answer.slice(0, 18) },
      { type: "text_delta", text: answer.slice(18) },
      { type: "answer", text: answer },
      { type: "done", steps: 2, usage: { inputTokens: 200, outputTokens: 20 } },
    ]);

    // Reference answer 1, as the model saw it.
    const result = model.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response as {
      range: unknown;
      rows: { channel: string; spend: number }[];
      totals: { spend: number };
    };
    assert.deepEqual(result.range, { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(result.rows, [
      { channel: "meta", spend: 37142.36 },
      { channel: "tiktok", spend: 24414.14 },
    ]);
    assert.equal(result.totals.spend, 61556.5);
    assert.match(model.requests[0]!.system, /Today is 2026-10-15/);
    assert.match(model.requests[0]!.system, /CAC for days less than 4 days old isn't final/);
  });

  it("flags metrics that aren't final and says through when they are", async () => {
    const model = new ScriptedModel((step) =>
      step === 1 ? call("query_metrics", { preset: "yesterday", metrics: ["cac", "cost_per_trial"] }) : say("ok"),
    );
    await ask(await appWith(model), "Why did CAC go up yesterday?");
    const result = model.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response as Record<string, unknown>;
    assert.deepEqual(result.totals, { cac: 200.25, cost_per_trial: 12.23, not_final: ["cac"] });
    assert.deepEqual(result.final_through, { cac: "2026-10-11" });
  });

  it("hands ratios over as percentages, so the model quotes instead of re-rounding", async () => {
    const model = new ScriptedModel((step) =>
      step === 1
        ? call("query_metrics", { from: "2026-10-01", to: "2026-10-10", channels: ["tiktok"], metrics: ["trial_to_sub"] })
        : say("ok"),
    );
    await ask(await appWith(model), "TikTok trial to sub in October?");
    const result = model.requests[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response as { totals: { trial_to_sub: number } };
    // Reference answer 3: 1,549 of 3,977 trials is 38.949…%, which reads 38.9%, not 39.0%.
    assert.equal(result.totals.trial_to_sub, 38.9);
  });

  it("hands bad tool arguments back to the model to fix", async () => {
    const model = new ScriptedModel((step) =>
      step === 1 ? call("query_metrics", { group_by: ["planet"], preset: "last_week" }) : step === 2 ? call("query_metrics", { metrics: ["spend"] }) : say("fixed"),
    );
    const out = events((await ask(await appWith(model), "x")).payload);
    const results = out.filter((e) => e.type === "tool_result");
    assert.deepEqual(
      results.map((r) => [r.ok, r.summary]),
      [
        [false, "Invalid arguments"],
        [false, "Give `preset`, or both `from` and `to`."],
      ],
    );
    assert.equal(out.at(-2)?.type, "answer");
  });

  it("forces an answer on the last step", async () => {
    const model = new ScriptedModel((_, req) => (req.allowTools ? call("get_budget_pacing", {}) : say("Here's what I found.")));
    const out = events((await ask(await appWith(model), "Loop forever")).payload);
    assert.equal(model.requests.length, AGENT_MAX_STEPS);
    assert.deepEqual(
      model.requests.map((r) => r.allowTools),
      [...Array(AGENT_MAX_STEPS - 1).fill(true), false],
    );
    assert.deepEqual(out.at(-2), { type: "answer", text: "Here's what I found." });
  });

  it("reports rate limits as an event instead of failing the request", async () => {
    const model = new ScriptedModel(() => {
      throw new ModelError("RATE_LIMITED", "The model is rate limited. Try again in about 30 s.", 30);
    });
    const res = await ask(await appWith(model), "Anything");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(events(res.payload), [
      { type: "error", code: "RATE_LIMITED", message: "The model is rate limited. Try again in about 30 s.", retryAfterSeconds: 30 },
      { type: "done", steps: 1, usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });

  it("answers 503 when no model is configured", async () => {
    const res = await ask(apps[0]!, "Anything");
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, "AGENT_DISABLED");
  });

  it("requires a session", async () => {
    const res = await ask(apps[0]!, "Anything", false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, "UNAUTHORIZED");
  });

  it("validates the conversation", async () => {
    const app = await appWith(new ScriptedModel(() => say("unused")));
    const send = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/agent/chat", headers: { authorization: `Bearer ${token}` }, payload });
    assert.equal((await send({ messages: [] })).json().error.code, "VALIDATION_ERROR");
    assert.equal((await send({ messages: [{ role: "assistant", text: "hi" }] })).json().error.code, "LAST_MESSAGE_NOT_USER");
    assert.equal((await send({ messages: [{ role: "user", text: "  " }] })).json().error.code, "EMPTY_QUESTION");
    assert.equal((await send({ messages: [{ role: "user", text: "x".repeat(2001) }] })).json().error.code, "QUESTION_TOO_LONG");
  });
});

describe("Gemini client", () => {
  const sse = (...chunks: unknown[]) =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  const ok = () =>
    sse(
      { candidates: [{ content: { role: "model", parts: [{ text: "Hel" }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "lo", thoughtSignature: "sig" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } },
    );
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  /** Drains a stream: the text it yielded and what it returned. */
  const drain = async (gen: AsyncGenerator<string, ModelResponse>) => {
    const deltas: string[] = [];
    let next = await gen.next();
    while (!next.done) {
      deltas.push(next.value);
      next = await gen.next();
    }
    return { deltas, res: next.value };
  };
  const retryInfo = (delay: string, quotaId = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier") => ({
    error: {
      code: 429,
      message: "quota",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay },
      ],
    },
  });
  const client = (responses: Response[]) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const waits: number[] = [];
    const gemini = new GeminiClient({
      apiKey: "test-key",
      model: "gemini-test",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return responses.shift()!;
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    return { gemini, calls, waits };
  };
  const request = { system: "s", contents: [], tools: [], allowTools: true };

  it("streams text as it arrives and keeps the parts for the next call", async () => {
    const { gemini, calls } = client([ok()]);
    const { deltas, res } = await drain(gemini.stream(request));
    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.deepEqual(res.content.parts, [{ text: "Hel" }, { text: "lo", thoughtSignature: "sig" }]);
    assert.deepEqual(res.usage, { inputTokens: 5, outputTokens: 2 });
    assert.match(calls[0]!.url, /:streamGenerateContent\?alt=sse$/);
  });

  it("doesn't stream the model's thoughts", async () => {
    const { gemini } = client([sse({ candidates: [{ content: { role: "model", parts: [{ text: "hmm", thought: true }, { text: "Answer" }] } }] })]);
    assert.deepEqual((await drain(gemini.stream(request))).deltas, ["Answer"]);
  });

  it("waits as long as Gemini asks, then retries", async () => {
    const { gemini, calls, waits } = client([json(429, retryInfo("2s")), ok()]);
    const { res } = await drain(gemini.stream(request));
    assert.equal(res.content.parts[1]?.text, "lo");
    assert.deepEqual(waits, [2000]);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(calls[0]!.url, /test-key/);
    assert.equal((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"], "test-key");
  });

  it("reports long waits instead of hanging", async () => {
    const { gemini, calls } = client([json(429, retryInfo("40s"))]);
    await assert.rejects(drain(gemini.stream(request)), { code: "RATE_LIMITED", retryAfterSeconds: 40 });
    assert.equal(calls.length, 1);
  });

  it("tells a used-up daily quota apart", async () => {
    const { gemini } = client([json(429, retryInfo("3600s", "GenerateRequestsPerDayPerProjectPerModel-FreeTier"))]);
    await assert.rejects(drain(gemini.stream(request)), { code: "QUOTA_EXHAUSTED" });
  });

  it("gives up on server errors after its attempts", async () => {
    const { gemini, calls } = client([json(503, {}), json(503, {}), json(503, {})]);
    await assert.rejects(drain(gemini.stream(request)), { code: "MODEL_UNAVAILABLE" });
    assert.equal(calls.length, 3);
  });

  it("keeps the provider's error message out of the user's", async () => {
    const { gemini } = client([json(400, { error: { code: 400, message: "API key not valid" } })]);
    await assert.rejects(drain(gemini.stream(request)), (err: ModelError) => {
      assert.equal(err.code, "MODEL_ERROR");
      assert.doesNotMatch(err.message, /API key not valid/);
      assert.equal(err.detail, "API key not valid");
      return true;
    });
  });
});
