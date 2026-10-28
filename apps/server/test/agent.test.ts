import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { ModelError, ZenMuxClient } from "../src/clients/zenmux.client.js";
import { AGENT_MAX_STEPS, AGENT_RECENT_MESSAGES } from "../src/constants/agent.constant.js";
import { TOOL_DECLARATIONS } from "../src/services/agent.tools.js";
import { splitFollowUps, toMessages } from "../src/services/agent.service.js";
import { ReleasesService } from "../src/services/releases.service.js";
import type { AgentEvent, ModelClient, ModelMessage, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import { CASE_DIR, testEnv } from "./helpers.js";

const usage = { inputTokens: 100, outputTokens: 10 };
const call = (name: string, args: Record<string, unknown>): ModelResponse => ({
  message: { role: "assistant", content: null, tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
  usage,
});
const say = (text: string): ModelResponse => ({ message: { role: "assistant", content: text }, usage });
/** The last tool result the model was sent. */
const lastToolResult = (req: ModelRequest) => {
  const msg = req.messages.at(-1) as Extract<ModelMessage, { role: "tool" }>;
  assert.equal(msg.role, "tool");
  return JSON.parse(msg.content) as Record<string, unknown>;
};

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
    const text = res.message.content;
    if (text) {
      const half = Math.ceil(text.length / 2);
      yield text.slice(0, half);
      yield text.slice(half);
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
  it("declares tools as plain JSON Schema functions", () => {
    assert.deepEqual(
      TOOL_DECLARATIONS.map((t) => t.function.name),
      ["query_metrics", "list_entities", "get_budget_pacing", "get_releases", "export_report"],
    );
    const params = TOOL_DECLARATIONS[0]!.function.parameters as { type: string; properties: Record<string, { type: string; items?: { type?: string; enum?: string[] } }> };
    assert.equal(params.type, "object");
    assert.equal(params.properties.group_by?.type, "array");
    assert.deepEqual(params.properties.group_by?.items?.type, "string");
    assert.ok(params.properties.group_by?.items?.enum?.includes("adset"));
    assert.equal(params.properties.limit?.type, "integer");
    assert.doesNotMatch(JSON.stringify(TOOL_DECLARATIONS), /examples|~kind/);
  });

  it("keeps recent messages verbatim and shortens older ones", () => {
    const turns = Array.from({ length: 6 }, (_, i) => [
      { role: "user" as const, text: `Question ${i}` },
      { role: "assistant" as const, text: `**Answer ${i} leads.** Then details ${i}.` },
    ]).flat();
    const messages = toMessages([...turns, { role: "user", text: "Latest?" }]);

    const digest = messages[0]!.content!;
    assert.match(digest, /^Earlier in this conversation/);
    assert.match(digest, /Q: Question 0\nA: Answer 0 leads\./);
    assert.doesNotMatch(digest, /details 0/);
    // The digest is the user's turn; the verbatim tail starts with the assistant's.
    assert.deepEqual(
      messages.map((m) => m.role),
      ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"],
    );
    assert.equal(messages.length, AGENT_RECENT_MESSAGES + 1);
    assert.equal(messages.at(-1)!.content, "Latest?");
  });
});

describe("follow-up questions", () => {
  it("reads the hidden block, numbered or bulleted, unclosed or not, and caps it", () => {
    assert.deepEqual(splitFollowUps("Answer.\n<!-- follow-ups\n1. One?\n2) Two?\n* Three?\n- Four?\n-->"), {
      answer: "Answer.",
      followUps: ["One?", "Two?", "Three?"],
    });
    assert.deepEqual(splitFollowUps("Answer.\n<!-- follow-ups\n- Cut off?"), { answer: "Answer.", followUps: ["Cut off?"] });
    assert.deepEqual(splitFollowUps("No block here."), { answer: "No block here.", followUps: [] });
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
      { type: "done", model: "deepseek/deepseek-v4.1-flash", steps: 2, usage: { inputTokens: 200, outputTokens: 20 } },
    ]);
    assert.equal(model.requests[0]!.model, "deepseek/deepseek-v4.1-flash");

    // Reference answer 1, as the model saw it.
    const result = lastToolResult(model.requests[1]!) as unknown as {
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
    const result = lastToolResult(model.requests[1]!);
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
    const result = lastToolResult(model.requests[1]!) as { totals: { trial_to_sub: number } };
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

  it("hands an export to the dashboard as a download", async () => {
    const model = new ScriptedModel((step) =>
      step === 1 ? call("export_report", { format: "pdf", preset: "last_week", country: "US" }) : say("Your PDF is downloading."),
    );
    const out = events((await ask(await appWith(model), "Export last week in the US as PDF")).payload);
    assert.deepEqual(out.slice(0, 3), [
      { type: "tool_call", id: "1.1", tool: "export_report", label: "Export PDF report · last week · US", args: { format: "pdf", preset: "last_week", country: "US" } },
      { type: "tool_result", id: "1.1", ok: true, summary: "Download ready" },
      { type: "export", id: "1.1", label: "Export PDF report · last week · US", format: "pdf", preset: "last_week", country: "US" },
    ]);
    assert.deepEqual((lastToolResult(model.requests[1]!) as { file: unknown }).file, { format: "pdf", preset: "last_week", country: "US" });
  });

  it("exports the dashboard's default period when none is named, and rejects half a range", async () => {
    const model = new ScriptedModel((step) =>
      step === 1
        ? call("export_report", { format: "csv", from: "2026-10-01" })
        : step === 2
          ? call("export_report", { format: "xlsx", tables: ["ads", "ads"] })
          : say("ok"),
    );
    const out = events((await ask(await appWith(model), "Excel please")).payload);
    assert.deepEqual(
      out.filter((e) => e.type === "tool_result").map((r) => [r.ok, r.summary]),
      [
        [false, "Give both `from` and `to`, or a `preset`."],
        [true, "Download ready"],
      ],
    );
    const exports = out.filter((e) => e.type === "export");
    assert.deepEqual(exports, [
      { type: "export", id: "2.1", label: "Export Excel workbook · last 14 days · ads, ads", format: "xlsx", preset: "last_14_days", tables: ["ads"] },
    ]);
  });

  it("exports Markdown too", async () => {
    const model = new ScriptedModel((step) => (step === 1 ? call("export_report", { format: "md", tables: ["countries"] }) : say("ok")));
    const out = events((await ask(await appWith(model), "Write it as markdown")).payload);
    assert.deepEqual(out.find((e) => e.type === "export"), {
      type: "export",
      id: "1.1",
      label: "Export Markdown · last 14 days · countries",
      format: "md",
      preset: "last_14_days",
      tables: ["countries"],
    });
  });

  it("sends follow-up questions apart from the answer", async () => {
    const text = "**You spent $61,556.50 last week.**\n\n<!-- follow-ups\n- How does that split by country?\n- Was CAC better than the week before?\n-->";
    const model = new ScriptedModel(() => say(text));
    const out = events((await ask(await appWith(model), "Spend last week?")).payload);
    assert.deepEqual(out.slice(-3, -1), [
      { type: "answer", text: "**You spent $61,556.50 last week.**" },
      { type: "follow_ups", questions: ["How does that split by country?", "Was CAC better than the week before?"] },
    ]);
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
      { type: "done", model: "deepseek/deepseek-v4.1-flash", steps: 1, usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });

  it("answers with the model the user picked, and lists the choices", async () => {
    const model = new ScriptedModel(() => say("ok"));
    const app = await appWith(model);
    const res = await app.inject({
      method: "POST",
      url: "/agent/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", text: "Hi" }], model: "z-ai/glm-5.2" },
    });
    assert.equal(model.requests[0]!.model, "z-ai/glm-5.2");
    assert.deepEqual(events(res.payload).at(-1), { type: "done", model: "z-ai/glm-5.2", steps: 1, usage });

    const unknown = await app.inject({
      method: "POST",
      url: "/agent/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", text: "Hi" }], model: "some/other-model" },
    });
    assert.equal(unknown.statusCode, 400);

    const list = (await app.inject({ url: "/agent/models", headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(list.data.default, "deepseek/deepseek-v4.1-flash");
    assert.deepEqual(
      list.data.models.map((m: { id: string }) => m.id),
      ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.2", "openai/gpt-6.1-sol"],
    );
  });

  it("hands arguments that aren't JSON back to the model", async () => {
    const model = new ScriptedModel((step) =>
      step === 1
        ? { message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "query_metrics", arguments: "{oops" } }] }, usage }
        : say("fixed"),
    );
    const out = events((await ask(await appWith(model), "x")).payload);
    assert.deepEqual(out.find((e) => e.type === "tool_result"), { type: "tool_result", id: "1.1", ok: false, summary: "Invalid arguments" });
    assert.match(lastToolResult(model.requests[1]!).error as string, /JSON object/);
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

describe("ZenMux client", () => {
  const sse = (...chunks: unknown[]) =>
    new Response([...chunks.map((c) => `data: ${JSON.stringify(c)}`), "data: [DONE]"].join("\r\n\r\n") + "\r\n\r\n", {
      headers: { "content-type": "text/event-stream" },
    });
  const delta = (d: Record<string, unknown>, finish_reason: string | null = null) => ({ choices: [{ delta: d, finish_reason }] });
  const ok = () =>
    sse(
      delta({ role: "assistant", reasoning_content: "Think" }),
      delta({ content: "Hel" }),
      delta({ content: "lo" }, "stop"),
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
    );
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
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
  const client = (responses: Response[]) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const waits: number[] = [];
    const zenmux = new ZenMuxClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return responses.shift()!;
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    return { zenmux, calls, waits };
  };
  const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
    model: "deepseek/deepseek-v4.1-flash",
    system: "s",
    messages: [{ role: "user", content: "q" }],
    tools: [],
    allowTools: true,
    ...overrides,
  });
  const sent = (call: { init: RequestInit }) => JSON.parse(String(call.init.body)) as Record<string, unknown>;

  it("streams text as it arrives and returns the whole message", async () => {
    const { zenmux, calls } = client([ok()]);
    const { deltas, res } = await drain(zenmux.stream(request()));
    assert.deepEqual(deltas, ["Hel", "lo"]);
    // The reasoning goes back with the message, but is never shown.
    assert.deepEqual(res.message, { role: "assistant", content: "Hello", reasoning_content: "Think" });
    assert.deepEqual(res.usage, { inputTokens: 5, outputTokens: 2 });
    assert.equal(calls[0]!.url, "https://zenmux.ai/api/v1/chat/completions");
    assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "Bearer test-key");
    const body = sent(calls[0]!);
    assert.equal(body.model, "deepseek/deepseek-v4.1-flash");
    assert.deepEqual((body.messages as unknown[])[0], { role: "system", content: "s" });
    assert.equal(body.stream, true);
    assert.equal(body.temperature, 0.2);
  });

  it("assembles tool calls streamed in pieces", async () => {
    const { zenmux } = client([
      sse(
        delta({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "query_metrics", arguments: "" } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"preset":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"last_week"}' } }, { index: 1, id: "call_b", function: { name: "get_releases", arguments: "{}" } }] }, "tool_calls"),
      ),
    ]);
    const { deltas, res } = await drain(zenmux.stream(request()));
    assert.deepEqual(deltas, []);
    assert.deepEqual(res.message.tool_calls, [
      { id: "call_a", type: "function", function: { name: "query_metrics", arguments: '{"preset":"last_week"}' } },
      { id: "call_b", type: "function", function: { name: "get_releases", arguments: "{}" } },
    ]);
  });

  it("forbids tools on the last step and leaves temperature to models that fix it", async () => {
    const { zenmux, calls } = client([ok()]);
    await drain(zenmux.stream(request({ model: "openai/gpt-6.1-sol", allowTools: false })));
    const body = sent(calls[0]!);
    assert.equal(body.tool_choice, "none");
    assert.equal("temperature" in body, false);
  });

  it("waits as long as the provider asks, then retries", async () => {
    const { zenmux, calls, waits } = client([json(429, { error: { message: "slow down" } }, { "retry-after": "2" }), ok()]);
    const { res } = await drain(zenmux.stream(request()));
    assert.equal(res.message.content, "Hello");
    assert.deepEqual(waits, [2000]);
    assert.equal(calls.length, 2);
  });

  it("reports long waits instead of hanging", async () => {
    const { zenmux, calls } = client([json(429, {}, { "retry-after": "40" })]);
    await assert.rejects(drain(zenmux.stream(request())), { code: "RATE_LIMITED", retryAfterSeconds: 40 });
    assert.equal(calls.length, 1);
  });

  it("tells an empty balance apart", async () => {
    const { zenmux } = client([json(402, { error: { message: "Insufficient balance" } })]);
    await assert.rejects(drain(zenmux.stream(request())), { code: "QUOTA_EXHAUSTED" });
  });

  it("gives up on server errors after its attempts", async () => {
    const { zenmux, calls } = client([json(503, {}), json(503, {}), json(503, {})]);
    await assert.rejects(drain(zenmux.stream(request())), { code: "MODEL_UNAVAILABLE" });
    assert.equal(calls.length, 3);
  });

  it("reports errors sent inside the stream", async () => {
    const { zenmux } = client([sse(delta({ content: "Hi" }), { error: { code: 503, message: "upstream gone" } })]);
    await assert.rejects(drain(zenmux.stream(request())), { code: "MODEL_UNAVAILABLE", detail: "upstream gone" });
  });

  it("keeps the provider's error message out of the user's", async () => {
    const { zenmux } = client([json(401, { error: { message: "Invalid API key" } })]);
    await assert.rejects(drain(zenmux.stream(request())), (err: ModelError) => {
      assert.equal(err.code, "MODEL_ERROR");
      assert.doesNotMatch(err.message, /Invalid API key/);
      assert.equal(err.detail, "Invalid API key");
      return true;
    });
  });
});
