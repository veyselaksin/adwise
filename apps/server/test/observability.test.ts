import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { ModelError } from "../src/clients/zenmux.client.js";
import { MODEL_PRICING } from "../src/constants/pricing.constant.js";
import { TelemetryRepository } from "../src/database/repositories/telemetry.repository.js";
import { openTelemetryDatabase, TELEMETRY_SCHEMA_VERSION } from "../src/database/telemetry.connection.js";
import { redact, redactContext, redactString } from "../src/lib/redact.js";
import { callCost, percentile, runTotals, type CallTotals } from "../src/lib/telemetry-math.js";
import { buckets, periodStats } from "../src/services/observability.service.js";
import type { TelemetryStore } from "../src/services/telemetry.service.js";
import type { AgentEvent, ModelClient, ModelResponse } from "../src/types/agent.type.js";
import type { ModelCallTelemetry } from "../src/types/telemetry.type.js";
import { testEnv } from "./helpers.js";

type App = Awaited<ReturnType<typeof buildApp>>;

const reported = (patch: Partial<ModelCallTelemetry> = {}): ModelCallTelemetry => ({
  inputTokens: 1000,
  outputTokens: 50,
  totalTokens: 1050,
  cachedInputTokens: 0,
  reasoningTokens: 10,
  providerCost: 0.0002,
  attempts: 1,
  providerRequestId: "zm-req-1",
  ...patch,
});
const notReported: ModelCallTelemetry = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  providerCost: null,
  attempts: 1,
  providerRequestId: null,
};
const toolCall = (name: string, args: Record<string, unknown>, telemetry = reported()): ModelResponse => ({
  message: { role: "assistant", content: null, tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
  usage: { inputTokens: telemetry.inputTokens ?? 0, outputTokens: telemetry.outputTokens ?? 0 },
  telemetry,
});
const say = (text: string, telemetry = reported()): ModelResponse => ({
  message: { role: "assistant", content: text },
  usage: { inputTokens: telemetry.inputTokens ?? 0, outputTokens: telemetry.outputTokens ?? 0 },
  telemetry,
});

/** Replays a script; a step may throw, and may wait first so durations are measurable. */
class ScriptedModel implements ModelClient {
  calls = 0;
  constructor(
    private readonly script: (step: number) => ModelResponse | Error,
    private readonly delayMs = 0,
  ) {}
  async *stream(): AsyncGenerator<string, ModelResponse> {
    const res = this.script(++this.calls);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (res instanceof Error) throw res;
    if (res.message.content) yield res.message.content;
    return res;
  }
}

let token = "";
const apps: App[] = [];
/**
 * Logs are persisted only when they're logged, so these apps log at info into a
 * discarded stream instead of the suite's usual `silent`.
 */
const quietLogger = { logger: { stream: { write: () => undefined } } };
async function appWith(opts: { model?: ModelClient; telemetryStore?: TelemetryStore; env?: Record<string, string> } = {}): Promise<App> {
  const app = await buildApp(testEnv({ LOG_LEVEL: "info", ...opts.env }), quietLogger, { model: opts.model, telemetryStore: opts.telemetryStore });
  apps.push(app);
  if (!token) {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    token = res.json().data.token;
  }
  return app;
}
const get = (app: App, url: string) => app.inject({ url, headers: { authorization: `Bearer ${token}` } });
const ask = async (app: App, text = "How much did we spend last week?") => {
  const res = await app.inject({
    method: "POST",
    url: "/agent/chat",
    headers: { authorization: `Bearer ${token}` },
    payload: { messages: [{ role: "user", text }] },
  });
  return res.payload.trim().split("\n").map((l) => JSON.parse(l) as AgentEvent);
};
const latestRun = async (app: App) => {
  const list = (await get(app, "/observability/runs?range=1h")).json().data;
  assert.ok(list.runs.length > 0, "a run was recorded");
  return (await get(app, `/observability/runs/${list.runs[0].runId}`)).json().data;
};

after(() => Promise.all(apps.map((a) => a.close())));

describe("agent run telemetry", () => {
  it("records a successful run with its model and tool spans, tokens and provider cost", async () => {
    const model = new ScriptedModel((step) =>
      step === 1 ? toolCall("query_metrics", { preset: "last_week", group_by: ["channel"], metrics: ["spend"] }) : say("**You spent $61,556.50.**"),
    );
    const app = await appWith({ model });
    const events = await ask(app);
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(events.some((e) => e.type === "answer"));

    const { run, spans, logs, partial } = await latestRun(app);
    assert.equal(run.status, "success");
    assert.equal(run.kind, "agent");
    assert.equal(run.model, "deepseek/deepseek-v4.1-flash");
    assert.equal(run.modelCallCount, 2);
    assert.equal(run.toolCallCount, 1);
    assert.equal(run.toolErrorCount, 0);
    assert.equal(run.inputTokens, 2000);
    assert.equal(run.outputTokens, 100);
    assert.equal(run.totalTokens, 2100);
    assert.equal(run.costSource, "provider");
    assert.ok(Math.abs(run.estimatedCost - 0.0004) < 1e-12);
    assert.equal(run.retryCount, 0);
    assert.ok(run.durationMs >= run.modelDurationMs);
    assert.ok(run.requestId);
    assert.deepEqual(partial, []);

    assert.deepEqual(spans.map((s: { kind: string }) => s.kind), ["model", "tool", "model"]);
    for (const s of spans) {
      assert.equal(s.parentSpanId, run.rootSpanId);
      assert.equal(s.traceId, run.traceId);
    }
    const tool = spans[1];
    assert.equal(tool.tool, "query_metrics");
    assert.equal(tool.status, "ok");
    assert.ok(tool.durationMs >= 0);
    assert.deepEqual(tool.metadata.argKeys, ["preset", "group_by", "metrics"]);
    assert.ok(tool.metadata.resultBytes > 0);
    // Spans carry facts about the lookup, never its result.
    assert.ok(!JSON.stringify(spans).includes("61556"));
    assert.equal(spans[0].providerRequestId, "zm-req-1");

    assert.ok(logs.some((l: { message: string; runId: string }) => l.message === "Agent run succeeded" && l.runId === run.runId));
  });

  it("records a failed run and still streams the original error", async () => {
    const model = new ScriptedModel(() => new ModelError("RATE_LIMITED", "The model is rate limited. Try again in about 5 s.", 5, "upstream says slow down", 3));
    const app = await appWith({ model });
    const events = await ask(app);
    // Unchanged behaviour: an error event with the stable code, then done.
    const error = events.find((e) => e.type === "error");
    assert.deepEqual(error, { type: "error", code: "RATE_LIMITED", message: "The model is rate limited. Try again in about 5 s.", retryAfterSeconds: 5 });
    assert.equal(events.at(-1)?.type, "done");

    const { run, spans } = await latestRun(app);
    assert.equal(run.status, "failure");
    assert.equal(run.errorCategory, "RATE_LIMITED");
    assert.match(run.errorMessage, /rate limited.*Provider: upstream says slow down/);
    assert.equal(run.retryCount, 2, "three attempts are two retries");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].status, "error");
    assert.equal(spans[0].errorCategory, "RATE_LIMITED");
    // A failed call reported no tokens: unknown, not zero.
    assert.equal(run.inputTokens, null);
    assert.equal(run.estimatedCost, null);
  });

  it("records a failed tool call without failing a run that still answered", async () => {
    const model = new ScriptedModel((step) => (step === 1 ? toolCall("query_metrics", { preset: "not_a_preset" }) : say("I couldn't look that up.")));
    const app = await appWith({ model });
    await ask(app);
    const { run, spans } = await latestRun(app);
    assert.equal(run.status, "success");
    assert.equal(run.toolErrorCount, 1);
    const tool = spans.find((s: { kind: string }) => s.kind === "tool");
    assert.equal(tool.status, "error");
    assert.equal(tool.errorCategory, "INVALID_ARGUMENTS");
  });

  it("measures model call durations on a monotonic clock", async () => {
    const app = await appWith({ model: new ScriptedModel(() => say("Done."), 60) });
    await ask(app);
    const { run, spans } = await latestRun(app);
    assert.ok(spans[0].durationMs >= 55, `model span took ${spans[0].durationMs} ms`);
    assert.ok(run.durationMs >= spans[0].durationMs);
  });

  it("classifies a model timeout", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const app = await appWith({ model: new ScriptedModel(() => timeout) });
    const events = await ask(app);
    assert.equal(events.find((e) => e.type === "error")?.type, "error");
    const { run } = await latestRun(app);
    assert.equal(run.status, "timeout");
    assert.equal(run.errorCategory, "MODEL_TIMEOUT");
  });

  it("records a run the client abandons as cancelled", async () => {
    const app = await appWith({ model: new ScriptedModel(() => say("A long answer.")) });
    const stream = app.services.agent!.chat([{ role: "user", text: "Hi" }], { model: "deepseek/deepseek-v4.1-flash" });
    await stream.next();
    await stream.return(undefined);
    const { run } = await latestRun(app);
    assert.equal(run.status, "cancelled");
  });

  it("keeps unreported usage null instead of 0", async () => {
    const app = await appWith({ model: new ScriptedModel(() => say("Done.", notReported)) });
    await ask(app);
    const { run } = await latestRun(app);
    assert.equal(run.usageReportedCalls, 0);
    assert.equal(run.inputTokens, null);
    assert.equal(run.outputTokens, null);
    assert.equal(run.totalTokens, null);
    assert.equal(run.estimatedCost, null);
    assert.equal(run.costCurrency, null);

    const summary = (await get(app, "/observability/summary?range=1h")).json().data;
    assert.equal(summary.current.tokens.input, null);
    assert.equal(summary.current.tokens.runsWithoutUsage, 1);
    assert.equal(summary.current.cost.total, null);
    assert.equal(summary.current.cost.unpricedRuns, 1);
  });
});

describe("telemetry failures", () => {
  const failing = (fail: Partial<Record<keyof TelemetryStore, boolean>>, real: () => TelemetryRepository): TelemetryStore => ({
    insertRun: (r) => (fail.insertRun ? boom() : real().insertRun(r)),
    insertSpan: (s) => (fail.insertSpan ? boom() : real().insertSpan(s)),
    finishRun: (id, d) => (fail.finishRun ? boom() : real().finishRun(id, d)),
  });
  const boom = () => {
    throw new Error("SQLITE_FULL: database or disk is full");
  };

  it("answers normally when every telemetry write fails", async () => {
    const app: App = await appWith({
      model: new ScriptedModel(() => say("**$1.00.**")),
      telemetryStore: failing({ insertRun: true, insertSpan: true, finishRun: true }, () => app.telemetryStore),
    });
    const events = await ask(app);
    assert.equal(events.find((e) => e.type === "answer")?.type, "answer");
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(app.telemetry.health().writeFailures, 3);
    const runtime = (await get(app, "/observability/runtime")).json().data;
    assert.equal(runtime.telemetry.runWriteFailures, 3);
  });

  it("still records a failure, not a success, when span writes fail", async () => {
    const app: App = await appWith({
      model: new ScriptedModel(() => new ModelError("MODEL_UNAVAILABLE", "The model is unavailable right now.")),
      telemetryStore: failing({ insertSpan: true }, () => app.telemetryStore),
    });
    const events = await ask(app);
    assert.equal(events.find((e) => e.type === "error")?.type, "error");
    const { run, spans, partial } = await latestRun(app);
    assert.equal(run.status, "failure");
    assert.equal(run.errorCategory, "MODEL_UNAVAILABLE");
    assert.equal(spans.length, 0);
    assert.equal(partial.length, 1, "the trace says spans are missing");
  });
});

describe("token and cost math", () => {
  const call = (patch: Partial<CallTotals> = {}): CallTotals => ({
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    cost: 0.001,
    costSource: "provider",
    attempts: 1,
    ...patch,
  });

  it("sums each call once, counting retries separately", () => {
    const t = runTotals([call({ attempts: 3 }), call()]);
    assert.equal(t.inputTokens, 200);
    assert.equal(t.outputTokens, 20);
    assert.equal(t.totalTokens, 220);
    assert.equal(t.cost, 0.002);
    assert.equal(t.retryCount, 2);
    assert.equal(t.costSource, "provider");
  });

  it("keeps reported tokens but drops the cost when one call is unpriced", () => {
    const t = runTotals([call(), call({ inputTokens: null, outputTokens: null, totalTokens: null, cost: null, costSource: null })]);
    assert.equal(t.usageReportedCalls, 1);
    assert.equal(t.inputTokens, 100);
    assert.equal(t.cost, null);
    assert.equal(t.costSource, null);
  });

  it("is null, not 0, with nothing reported", () => {
    const t = runTotals([call({ inputTokens: null, outputTokens: null, totalTokens: null, cost: null, costSource: null, attempts: null })]);
    assert.deepEqual([t.inputTokens, t.outputTokens, t.totalTokens, t.cost, t.retryCount], [null, null, null, null, null]);
    assert.equal(runTotals([]).cost, null);
  });

  it("labels mixed cost sources", () => {
    assert.equal(runTotals([call(), call({ costSource: "estimate" })]).costSource, "mixed");
  });

  it("derives a total only for a call that sent none", () => {
    assert.equal(runTotals([call({ totalTokens: null }), call()]).totalTokens, 220);
  });

  it("prefers the provider's cost, then estimates from configured prices", () => {
    const deepseek = MODEL_PRICING["deepseek/deepseek-v4.1-flash"];
    assert.deepEqual(callCost({ inputTokens: 34, outputTokens: 12, providerCost: 0.0000123 }, deepseek), { cost: 0.0000123, source: "provider" });
    const est = callCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, providerCost: null }, deepseek);
    assert.equal(est?.source, "estimate");
    assert.ok(Math.abs(est!.cost - 0.75) < 1e-9);
  });

  it("has no cost without a price or without both token counts", () => {
    assert.equal(callCost({ inputTokens: 100, outputTokens: 10, providerCost: null }, undefined), null);
    assert.equal(callCost({ inputTokens: 100, outputTokens: null, providerCost: null }, MODEL_PRICING["z-ai/glm-5.2"]), null);
  });

  it("uses the long-prompt tier above its threshold", () => {
    const gpt = MODEL_PRICING["openai/gpt-6.1-sol"];
    const short = callCost({ inputTokens: 100_000, outputTokens: 0, providerCost: null }, gpt)!;
    const long = callCost({ inputTokens: 300_000, outputTokens: 0, providerCost: null }, gpt)!;
    assert.ok(Math.abs(short.cost - 0.2) < 1e-9);
    assert.ok(Math.abs(long.cost - 1.2) < 1e-9);
  });

  it("takes nearest-rank percentiles", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    assert.equal(percentile(values, 95), 19);
    assert.equal(percentile(values, 50), 10);
    assert.equal(percentile([], 95), null);
  });
});

describe("redaction", () => {
  it("removes secrets from strings", () => {
    const text = redactString(
      "auth Bearer abc.def.ghijklmnop key sk-live_ABCDEFGHIJKLMNOP jwt eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM url /mcp/0123456789abcdef0123456789 ?api_key=hunter2",
    );
    for (const secret of ["abc.def.ghijklmnop", "sk-live_ABCDEFGHIJKLMNOP", "eyJhbGciOi", "0123456789abcdef0123456789", "hunter2"]) {
      assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
    }
  });

  it("drops secret and content fields at any depth", () => {
    const out = redact({
      headers: { authorization: "Bearer x", cookie: "s=1" },
      nested: { password: "p", apiKey: "k", ZENMUX_API_KEY: "z" },
      prompt: "What did we spend?",
      rows: [{ spend: 1 }],
      tool: "query_metrics",
    }) as Record<string, Record<string, unknown>>;
    assert.equal(out.headers!.authorization, "[REDACTED]");
    assert.equal(out.headers!.cookie, "[REDACTED]");
    assert.equal(out.nested!.password, "[REDACTED]");
    assert.equal(out.nested!.apiKey, "[REDACTED]");
    assert.equal(out.nested!.ZENMUX_API_KEY, "[REDACTED]");
    assert.equal(out.prompt, "[OMITTED]");
    assert.equal(out.rows, "[OMITTED]");
    assert.equal(out.tool, "query_metrics");
  });

  it("caps the stored size", () => {
    const big = redactContext({ code: "X", blob: { a: "y".repeat(400), b: "y".repeat(400), c: Array(20).fill("z".repeat(400)) } });
    assert.equal(big.truncated, true);
    assert.equal(big.code, "X");
    assert.ok(Buffer.byteLength(JSON.stringify(big)) < 4096);
  });

  it("persists log lines through the central redaction", async () => {
    const app = await appWith();
    app.log.warn(
      { component: "test", authorization: "Bearer abcdefghijklmnop", detail: "key sk-abcdefghijklmnopqrstu", runId: "run-1" },
      "Upstream rejected Bearer abcdefghijklmnop",
    );
    const page = (await get(app, "/observability/logs?range=1h&component=test")).json().data;
    assert.equal(page.entries.length, 1);
    const stored = JSON.stringify(page.entries[0]);
    assert.ok(!stored.includes("abcdefghijklmnop"), stored);
    assert.ok(!stored.includes("sk-abcdefghijklmnopqrstu"), stored);
    assert.equal(page.entries[0].level, "warn");
    assert.equal(page.entries[0].runId, "run-1");
  });

  it("doesn't persist per-request info lines", async () => {
    const app = await appWith();
    await get(app, "/health");
    app.log.info("plain info without a component");
    const page = (await get(app, "/observability/logs?range=1h")).json().data;
    assert.ok(!page.entries.some((e: { message: string }) => /request completed|incoming request|plain info/.test(e.message)));
  });
});

describe("observability API", () => {
  let app: App;
  let repo: TelemetryRepository;
  const now = Date.now();
  const seed = (startedAt: number, patch: { status?: string; duration?: number; tokens?: number | null; cost?: number | null; model?: string } = {}) => {
    const id = randomUUID();
    repo.insertRun({ run_id: id, trace_id: randomUUID().replace(/-/g, ""), root_span_id: "r", kind: "agent", started_at: startedAt, provider: "zenmux", model: patch.model ?? "z-ai/glm-5.2", request_id: null });
    repo.finishRun(id, {
      status: patch.status ?? "success",
      completed_at: startedAt + (patch.duration ?? 1000),
      duration_ms: patch.duration ?? 1000,
      error_category: null,
      error_message: null,
      model_call_count: 1,
      tool_call_count: 0,
      tool_error_count: 0,
      retry_count: 0,
      usage_reported_calls: patch.tokens === null ? 0 : 1,
      input_tokens: patch.tokens === undefined ? 100 : patch.tokens,
      output_tokens: patch.tokens === undefined ? 10 : patch.tokens,
      total_tokens: patch.tokens === undefined ? 110 : patch.tokens,
      cost_usd: patch.cost === undefined ? 0.01 : patch.cost,
      cost_source: patch.cost === null ? null : "provider",
      model_duration_ms: (patch.duration ?? 1000) - 100,
      tool_duration_ms: null,
    });
    return id;
  };

  before(async () => {
    app = await appWith();
    repo = app.telemetryStore;
    for (let i = 0; i < 30; i++) seed(now - (i + 1) * 60_000, { duration: 1000 + i * 100 });
    seed(now - 2 * 86_400_000, { status: "failure" });
    seed(now - 3 * 60_000, { status: "failure", tokens: null, cost: null, model: "openai/gpt-6.1-sol" });
  });

  it("requires a session on every endpoint", async () => {
    for (const url of ["summary", "timeseries", "runs", "runs/abcd", "logs", "runtime"]) {
      const res = await app.inject({ url: `/observability/${url}` });
      assert.equal(res.statusCode, 401, url);
      assert.equal(res.json().error.code, "UNAUTHORIZED");
    }
  });

  it("pages runs with a default and a hard limit", async () => {
    const first = (await get(app, "/observability/runs?range=24h")).json();
    assert.equal(first.success, true);
    assert.equal(first.data.total, 31);
    assert.equal(first.data.runs.length, 25);
    const second = (await get(app, "/observability/runs?range=24h&offset=25")).json().data;
    assert.equal(second.runs.length, 6);
    assert.ok(!second.runs.some((r: { runId: string }) => first.data.runs.some((f: { runId: string }) => f.runId === r.runId)));

    const tooMany = await get(app, "/observability/runs?range=24h&limit=500");
    assert.equal(tooMany.statusCode, 400);
    assert.equal(tooMany.json().error.code, "VALIDATION_ERROR");
  });

  it("applies the window, filters and sort", async () => {
    assert.equal((await get(app, "/observability/runs?range=7d")).json().data.total, 32);
    assert.equal((await get(app, "/observability/runs?range=24h&status=failed")).json().data.total, 1);
    assert.equal((await get(app, "/observability/runs?range=24h&model=openai%2Fgpt-6.1-sol")).json().data.total, 1);
    assert.equal((await get(app, "/observability/runs?range=24h&minDurationMs=3500")).json().data.total, 5);
    const slowest = (await get(app, "/observability/runs?range=24h&sort=durationMs&order=desc&limit=1")).json().data.runs[0];
    assert.equal(slowest.durationMs, 3900);
    const byPrefix = (await get(app, `/observability/runs?range=24h&q=${slowest.runId.slice(0, 8)}`)).json().data;
    assert.ok(byPrefix.runs.some((r: { runId: string }) => r.runId === slowest.runId));
    assert.equal((await get(app, "/observability/runs?range=24h&q=ab%25")).statusCode, 400, "no LIKE wildcards");
    assert.equal((await get(app, "/observability/runs?range=2y")).statusCode, 400);
  });

  it("summarizes the window with honest denominators", async () => {
    const s = (await get(app, "/observability/summary?range=24h")).json().data;
    assert.equal(s.current.runs.total, 31);
    assert.equal(s.current.runs.success, 30);
    assert.ok(Math.abs(s.current.successRate - 30 / 31) < 1e-9);
    assert.equal(s.current.p95DurationMs, 3800);
    assert.equal(s.current.tokens.input, 3000);
    assert.equal(s.current.cost.pricedRuns, 30);
    assert.equal(s.current.cost.unpricedRuns, 1);
    // The previous 24 h hold one run: too few to compare.
    assert.equal(s.previous, null);
  });

  it("buckets runs by start time without filling gaps", async () => {
    const t = (await get(app, "/observability/timeseries?range=24h")).json().data;
    assert.ok(t.buckets.length === 24 || t.buckets.length === 25);
    assert.equal(t.buckets.reduce((n: number, b: { runs: number }) => n + b.runs, 0), 31);
    const empty = t.buckets.find((b: { runs: number }) => b.runs === 0);
    assert.equal(empty.avgDurationMs, null);
    assert.equal(empty.inputTokens, null);
    assert.equal(empty.cost, null);
  });

  it("returns a run by id or trace id, and 404 for an unknown one", async () => {
    const [run] = (await get(app, "/observability/runs?range=24h&limit=1")).json().data.runs;
    assert.equal((await get(app, `/observability/runs/${run.traceId}`)).json().data.run.runId, run.runId);
    const missing = await get(app, "/observability/runs/0000aaaa");
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "RUN_NOT_FOUND");
  });

  it("pages logs newest first and filters errors", async () => {
    for (let i = 0; i < 5; i++) app.log.error({ component: "paging", errorCategory: "TEST" }, `error ${i}`);
    app.log.warn({ component: "paging" }, "a warning");
    const first = (await get(app, "/observability/logs?range=1h&component=paging&limit=4")).json().data;
    assert.equal(first.entries.length, 4);
    assert.equal(first.entries[0].message, "a warning");
    assert.ok(first.nextBefore);
    const rest = (await get(app, `/observability/logs?range=1h&component=paging&limit=4&before=${first.nextBefore}`)).json().data;
    assert.equal(rest.entries.length, 2);
    assert.equal(rest.nextBefore, null);
    const errors = (await get(app, "/observability/logs?range=1h&component=paging&errorsOnly=true")).json().data;
    assert.equal(errors.entries.length, 5);
    assert.equal((await get(app, "/observability/logs?range=1h&limit=1000")).statusCode, 400);
  });
});

describe("aggregation helpers", () => {
  const row = (startedAt: number, status: string, duration: number | null) =>
    ({
      run_id: randomUUID(), trace_id: "t", root_span_id: "r", kind: "agent", status, started_at: startedAt, completed_at: null,
      duration_ms: duration, provider: "zenmux", model: "m", request_id: null, error_category: null, error_message: null,
      model_call_count: 1, tool_call_count: 0, tool_error_count: 0, retry_count: null, usage_reported_calls: 0,
      input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null, cost_source: null, model_duration_ms: null, tool_duration_ms: null,
    });

  it("has no success rate without finished runs", () => {
    const s = periodStats([row(0, "running", null), row(0, "cancelled", 10)]);
    assert.equal(s.successRate, null);
    assert.equal(s.avgDurationMs, null);
    assert.equal(s.p95DurationMs, null);
  });

  it("places runs in UTC-aligned buckets inside [from, to)", () => {
    const hour = 3_600_000;
    const from = 10 * hour + 30 * 60_000;
    const out = buckets([row(from + 1, "success", 100), row(11 * hour + 5, "failure", 50), row(from - 1, "success", 1)], from, from + 2 * hour, hour);
    assert.deepEqual(out.map((b) => [b.start, b.runs, b.success, b.failed]), [
      [new Date(10 * hour).toISOString(), 1, 1, 0],
      [new Date(11 * hour).toISOString(), 1, 0, 1],
      [new Date(12 * hour).toISOString(), 0, 0, 0],
    ]);
    assert.equal(out[0]!.avgDurationMs, 100);
    assert.equal(out[1]!.avgDurationMs, null, "failed runs don't count toward duration");
  });
});

describe("telemetry store", () => {
  it("migrates once and marks runs a previous process left running as interrupted", async () => {
    const path = join(tmpdir(), `adwise-telemetry-${randomUUID()}.db`);
    const db = openTelemetryDatabase(path);
    new TelemetryRepository(db).insertRun({ run_id: "left-running", trace_id: "t1", root_span_id: "r1", kind: "agent", started_at: Date.now() - 1000, provider: "zenmux", model: "m", request_id: null });
    db.close();
    // Opening again applies no migration twice.
    const again = openTelemetryDatabase(path);
    assert.equal((again.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, TELEMETRY_SCHEMA_VERSION);
    again.close();

    const app = await appWith({ env: { TELEMETRY_PATH: path } });
    const run = (await get(app, "/observability/runs/left-running")).json().data;
    assert.equal(run.run.status, "interrupted");
    assert.equal(run.run.errorCategory, "PROCESS_RESTART");
    assert.ok(run.partial.length > 0);
  });
});

describe("runtime", () => {
  it("reports this process's memory in bytes, with CPU only after a measured interval", async () => {
    const app = await appWith();
    const first = (await get(app, "/observability/runtime")).json().data;
    assert.equal(first.scope, "process");
    assert.equal(first.cpu, null, "no CPU figure before the first sample interval");
    const { heapUsedBytes, heapTotalBytes, rssBytes } = first.memory;
    assert.ok(Number.isInteger(heapUsedBytes) && heapUsedBytes > 1_000_000, "bytes, not MB");
    assert.ok(heapUsedBytes <= heapTotalBytes);
    assert.ok(rssBytes > 0);
    assert.equal(first.process.nodeVersion, process.version);
    assert.deepEqual(first.checks.map((c: { status: string }) => c.status), ["ok", "ok"]);
    assert.equal(first.status, "ok");

    await new Promise((r) => setTimeout(r, 30));
    app.services.runtime.sample();
    const second = (await get(app, "/observability/runtime")).json().data;
    assert.ok(second.cpu.percentOfOneCore >= 0);
    assert.ok(second.cpu.intervalMs >= 25);
    assert.equal(second.samples.length, 1);
    assert.ok(second.eventLoop.maxMs === null || second.eventLoop.maxMs >= 0);
  });
});
