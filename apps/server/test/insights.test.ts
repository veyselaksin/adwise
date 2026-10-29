import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { SNAPSHOT_TTL_MS } from "../src/constants/insights.constant.js";
import { SnapshotSigner } from "../src/lib/snapshot.js";
import { InsightsService } from "../src/services/insights.service.js";
import type { AgentEvent, ModelClient, ModelMessage, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import type { Snapshot } from "../src/types/insights.type.js";
import { testEnv } from "./helpers.js";

const usage = { inputTokens: 100, outputTokens: 10 };

/** Calls the scripted tools in order, then answers with `answer`. Records what the model was sent. */
class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(
    private readonly calls: { name: string; args: Record<string, unknown> }[],
    private readonly answer: string,
  ) {}
  // eslint-disable-next-line require-yield
  async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    const step = this.requests.length;
    const call = this.calls[step - 1];
    if (call) {
      return {
        message: { role: "assistant", content: null, tool_calls: [{ id: `c${step}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] },
        usage,
      };
    }
    return { message: { role: "assistant", content: this.answer }, usage };
  }
}

describe("insights", () => {
  const env = testEnv();
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  let otherToken = "";

  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, as: string | null = token) =>
    app.inject({ method, url, ...(payload && { payload }), headers: as ? { authorization: `Bearer ${as}` } : {} });

  /** Asks the real agent route (scripted model) and returns its stream and signed snapshot. */
  async function ask(question: string, calls: { name: string; args: Record<string, unknown> }[], answer: string) {
    const model = new ScriptedModel(calls, answer);
    const agentApp = await buildApp(env, {}, { model });
    apps.push(agentApp);
    const res = await agentApp.inject({
      method: "POST",
      url: "/agent/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", text: "Earlier question?" }, { role: "assistant", text: "Earlier answer." }, { role: "user", text: question }] },
    });
    const events = res.payload.trim().split("\n").map((l) => JSON.parse(l) as AgentEvent);
    const snapshot = events.find((e) => e.type === "snapshot");
    return { events, model, snapshot: snapshot?.type === "snapshot" ? snapshot.token : undefined };
  }

  const lastWeekCac = { name: "query_metrics", args: { preset: "last_week", group_by: ["channel"], metrics: ["spend", "cac"] } };
  const answer = "**Blended CAC last week was within range.** Meta led on spend.";

  before(async () => {
    app = await buildApp(env);
    apps.push(app);
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    token = res.json().data.token;
    otherToken = app.jwt.sign({ sub: "someone-else" });
  });
  after(() => Promise.all(apps.map((a) => a.close())));

  it("needs a token on every route", async () => {
    const id = "3f1c2a8e-7c1d-4b8a-9a52-1d2f3e4a5b6c";
    for (const [method, url, body] of [
      ["GET", "/insights"],
      ["POST", "/insights/preview", { token: "x" }],
      ["POST", "/insights", { token: "x", title: "x" }],
      ["GET", `/insights/${id}`],
      ["PATCH", `/insights/${id}`, { title: "x" }],
      ["DELETE", `/insights/${id}`],
    ] as const) {
      const res = await call(method, url, body, null);
      assert.equal(res.statusCode, 401, `${method} ${url}`);
      assert.equal(res.json().error.code, "UNAUTHORIZED");
    }
  });

  it("signs a snapshot of a complete answer with the lookups the model read", async () => {
    const { events, model, snapshot } = await ask("What was CAC by channel last week?", [lastWeekCac], answer);
    assert.ok(snapshot);
    // Right after the answer, before done.
    assert.deepEqual(events.slice(-3).map((e) => e.type), ["answer", "snapshot", "done"]);

    const draft = (await call("POST", "/insights/preview", { token: snapshot })).json().data;
    assert.equal(draft.title, "What was CAC by channel last week?");
    assert.equal(draft.summary, "Blended CAC last week was within range.");
    assert.equal(draft.snapshot.answer, answer);
    assert.deepEqual(draft.snapshot.earlierQuestions, ["Earlier question?"]);
    assert.equal(draft.snapshot.model.label, "DeepSeek V4.1 Flash");
    // The evidence is exactly the tool output the model was sent.
    const sent = model.requests[1]!.messages.at(-1) as Extract<ModelMessage, { role: "tool" }>;
    assert.deepEqual(draft.snapshot.evidence[0].data, JSON.parse(sent.content));
    assert.equal(draft.snapshot.evidence[0].label, "spend, cac by channel · last week");
    // Scope comes from the evidence, not the answer's wording.
    assert.deepEqual(draft.scope.period, { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(draft.scope.metrics.map((m: { key: string }) => m.key), ["spend", "cac"]);
    assert.equal(draft.scope.metrics[1].formula, "spend ÷ subscriptions");
    assert.equal(draft.scope.metrics[1].finalAfterDays, 4);
    // Preview writes nothing.
    assert.deepEqual((await call("GET", "/insights")).json().data, []);
  });

  it("sends no snapshot when the answer fails", async () => {
    const model: ModelClient = {
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<string, ModelResponse> {
        return { message: { role: "assistant", content: "" }, usage };
      },
    };
    const agentApp = await buildApp(env, {}, { model });
    apps.push(agentApp);
    const res = await agentApp.inject({ method: "POST", url: "/agent/chat", headers: { authorization: `Bearer ${token}` }, payload: { messages: [{ role: "user", text: "x" }] } });
    assert.ok(!res.payload.includes('"snapshot"'));
  });

  it("refuses changed, foreign, malformed and stale snapshots", async () => {
    const { snapshot } = await ask("Spend last week?", [lastWeekCac], answer);
    const [body, mac] = snapshot!.split(".");
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString()) as Snapshot;

    // A number changed in the browser.
    const forged = { ...payload, answer: "CAC was $1.00." };
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${mac}`;
    const foreign = new SnapshotSigner("another-secret-that-is-at-least-32-chars").sign(payload);
    for (const bad of [tampered, foreign, "garbage", `${body}.`, `${snapshot}.x`]) {
      const res = await call("POST", "/insights", { token: bad, title: "x" });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, "INVALID_SNAPSHOT");
    }

    const stale = new SnapshotSigner(env.JWT_SECRET).sign({ ...payload, answeredAt: new Date(Date.now() - SNAPSHOT_TTL_MS - 1000).toISOString() });
    assert.equal((await call("POST", "/insights", { token: stale, title: "x" })).json().error.code, "SNAPSHOT_EXPIRED");
    assert.deepEqual((await call("GET", "/insights")).json().data, []);
  });

  it("validates the title", async () => {
    const { snapshot } = await ask("Spend last week?", [lastWeekCac], answer);
    const blank = await call("POST", "/insights", { token: snapshot, title: "   " });
    assert.equal(blank.statusCode, 400);
    assert.equal(blank.json().error.code, "EMPTY_TITLE");
    assert.equal((await call("POST", "/insights", { token: snapshot })).statusCode, 400);
  });

  let saved: { id: string; snapshot: Snapshot; createdAt: string };

  it("saves an insight, keeps it on disk, and opens it unchanged", async () => {
    const { snapshot } = await ask("What was CAC by channel last week?", [lastWeekCac], answer);
    const preview = (await call("POST", "/insights/preview", { token: snapshot })).json().data;

    const res = await call("POST", "/insights", { token: snapshot, title: "  CAC   by channel " });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().message, "Insight saved");
    saved = res.json().data;
    assert.equal(res.json().data.title, "CAC by channel");
    assert.equal(res.json().data.owner, "marketing");
    assert.equal(res.json().data.mine, true);
    assert.equal(res.json().data.sourceHash, undefined);
    assert.deepEqual(saved.snapshot, preview.snapshot);

    // Survives a restart: a fresh service reads the same report from the file.
    const reloaded = await InsightsService.load(env.INSIGHTS_PATH, { signer: new SnapshotSigner(env.JWT_SECRET), metrics: app.services.metrics, entities: app.services.entities });
    assert.deepEqual(reloaded.get(saved.id, "marketing").snapshot, preview.snapshot);

    const opened = (await call("GET", `/insights/${saved.id}`)).json().data;
    assert.deepEqual(opened, res.json().data);

    // The same answer can be saved once.
    const again = await call("POST", "/insights", { token: snapshot, title: "Again" });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error.code, "INSIGHT_EXISTS");
  });

  it("searches by title, question and campaign, sorts, and filters by save day", async () => {
    const { campaigns } = await app.services.entities.list();
    const campaign = campaigns[0]!;
    const one = await ask("How is that campaign doing?", [{ name: "query_metrics", args: { preset: "last_7_days", campaign_ids: [campaign.id], metrics: ["cac"] } }], "**It's fine.**");
    const two = await ask("Trial to sub in Germany?", [{ name: "query_metrics", args: { preset: "last_week", countries: ["DE"], metrics: ["trial_to_sub"] } }], "**Steady.**");
    const a = (await call("POST", "/insights", { token: one.snapshot, title: "Campaign check" })).json().data;
    const b = (await call("POST", "/insights", { token: two.snapshot, title: "Germany funnel" })).json().data;
    assert.deepEqual(a.scope.campaigns, [{ id: campaign.id, name: campaign.name, channel: campaign.channel, country: campaign.country }]);
    assert.deepEqual(b.scope.countries, ["DE"]);

    const ids = async (qs: string) => (await call("GET", `/insights${qs}`)).json().data.map((i: { id: string }) => i.id);
    assert.deepEqual(await ids(""), [b.id, a.id, saved.id]);
    assert.deepEqual(await ids("?sort=oldest"), [saved.id, a.id, b.id]);
    assert.deepEqual(await ids("?q=GERMANY"), [b.id]); // title and question, any case
    assert.deepEqual(await ids("?q=cac%20by"), [saved.id]);
    assert.deepEqual(await ids(`?q=${encodeURIComponent(campaign.name)}`), [a.id]);
    assert.deepEqual(await ids("?q=nothing-like-this"), []);

    const today = saved.createdAt.slice(0, 10);
    assert.equal((await ids(`?from=${today}&to=${today}`)).length, 3);
    assert.deepEqual(await ids("?from=2099-01-01"), []);
    assert.equal((await call("GET", "/insights?from=2026-10-10&to=2026-10-01")).json().error.code, "INVALID_RANGE");
    assert.equal((await call("GET", "/insights?sort=random")).statusCode, 400);

    const row = (await call("GET", `/insights?q=${encodeURIComponent(campaign.name)}`)).json().data[0];
    assert.deepEqual(Object.keys(row).sort(), ["campaigns", "createdAt", "evidenceCount", "id", "mine", "model", "owner", "period", "question", "summary", "title", "updatedAt"]);
  });

  it("renames without touching the snapshot", async () => {
    const res = await call("PATCH", `/insights/${saved.id}`, { title: "CAC by channel, week of Oct 5" });
    assert.equal(res.statusCode, 200);
    const renamed = res.json().data;
    assert.equal(renamed.title, "CAC by channel, week of Oct 5");
    assert.deepEqual(renamed.snapshot, saved.snapshot);
    assert.equal(renamed.createdAt, saved.createdAt);
    assert.ok(renamed.updatedAt >= saved.createdAt);
    assert.equal((await call("PATCH", `/insights/${saved.id}`, { title: " " })).json().error.code, "EMPTY_TITLE");
  });

  it("lets teammates open a shared insight but not change it", async () => {
    const opened = await call("GET", `/insights/${saved.id}`, undefined, otherToken);
    assert.equal(opened.statusCode, 200);
    assert.equal(opened.json().data.mine, false);
    const row = (await call("GET", "/insights", undefined, otherToken)).json().data.find((i: { id: string }) => i.id === saved.id);
    assert.equal(row.mine, false);

    for (const [method, body] of [["PATCH", { title: "Mine now" }], ["DELETE", undefined]] as const) {
      const res = await call(method, `/insights/${saved.id}`, body, otherToken);
      assert.equal(res.statusCode, 403, method);
      assert.equal(res.json().error.code, "FORBIDDEN");
    }
    assert.equal((await call("GET", `/insights/${saved.id}`)).json().data.title, "CAC by channel, week of Oct 5");
  });

  it("deletes an insight, and answers 404 for missing ones", async () => {
    const res = await call("DELETE", `/insights/${saved.id}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.id, saved.id);
    for (const method of ["GET", "DELETE"] as const) {
      const missing = await call(method, `/insights/${saved.id}`);
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().error.code, "INSIGHT_NOT_FOUND");
    }
    assert.equal((await call("PATCH", `/insights/${saved.id}`, { title: "x" })).statusCode, 404);
    assert.equal((await call("GET", "/insights/not-a-uuid")).statusCode, 400);
  });
});
