import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { RULE_MAX_CHARS } from "../src/constants/rules.constant.js";
import { RulesService } from "../src/services/rules.service.js";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/types/agent.type.js";
import { testEnv } from "./helpers.js";

/** Answers at once and keeps the system prompt it was sent. */
class PromptRecorder implements ModelClient {
  readonly systems: string[] = [];
  // eslint-disable-next-line require-yield
  async *stream(req: ModelRequest): AsyncGenerator<string, ModelResponse> {
    this.systems.push(req.system);
    return { content: { role: "model", parts: [{ text: "ok" }] }, usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

describe("team rules", () => {
  const env = testEnv();
  const model = new PromptRecorder();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = "";
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object, auth = true) =>
    app.inject({ method, url, ...(payload && { payload }), headers: auth ? { authorization: `Bearer ${token}` } : {} });
  const ask = () => call("POST", "/agent/chat", { messages: [{ role: "user", text: "Spend last week?" }] });

  before(async () => {
    app = await buildApp(env, {}, { model });
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    token = res.json().data.token;
  });
  after(() => app.close());

  it("starts empty", async () => {
    const res = await call("GET", "/rules");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { success: true, message: "Rules loaded", data: [] });
  });

  it("adds a rule the agent follows from the next question, and keeps it on disk", async () => {
    const res = await call("POST", "/rules", { text: "  Show Brazil   in BRL too. " });
    assert.equal(res.statusCode, 200);
    const rule = res.json().data;
    assert.equal(rule.text, "Show Brazil in BRL too.");
    assert.equal(rule.enabled, true);

    await ask();
    assert.match(model.systems.at(-1)!, /# Rules the team added later[^\n]*\n1\. Show Brazil in BRL too\./);

    const reloaded = await RulesService.load(env.RULES_PATH);
    assert.deepEqual(reloaded.list(), [rule]);
  });

  it("leaves switched-off rules out of the prompt", async () => {
    const [rule] = (await call("GET", "/rules")).json().data;
    const res = await call("PATCH", `/rules/${rule.id}`, { enabled: false });
    assert.equal(res.json().data.enabled, false);
    await ask();
    assert.doesNotMatch(model.systems.at(-1)!, /Rules the team added/);
  });

  it("deletes a rule", async () => {
    const [rule] = (await call("GET", "/rules")).json().data;
    assert.equal((await call("DELETE", `/rules/${rule.id}`)).statusCode, 200);
    assert.deepEqual((await call("GET", "/rules")).json().data, []);
    const again = await call("DELETE", `/rules/${rule.id}`);
    assert.equal(again.statusCode, 404);
    assert.equal(again.json().error.code, "RULE_NOT_FOUND");
  });

  it("keeps parallel writes", async () => {
    await Promise.all(["One.", "Two.", "Three."].map((text) => call("POST", "/rules", { text })));
    const reloaded = await RulesService.load(env.RULES_PATH);
    assert.deepEqual(reloaded.list().map((r) => r.text).sort(), ["One.", "Three.", "Two."]);
  });

  it("validates rules", async () => {
    const blank = await call("POST", "/rules", { text: "   " });
    assert.equal(blank.statusCode, 400);
    assert.equal(blank.json().error.code, "EMPTY_RULE");
    assert.equal((await call("POST", "/rules", { text: "x".repeat(RULE_MAX_CHARS + 1) })).statusCode, 400);
    assert.equal((await call("PATCH", "/rules/not-an-id", { enabled: true })).statusCode, 400);
  });

  it("requires a session", async () => {
    const res = await call("GET", "/rules", undefined, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().success, false);
  });
});
