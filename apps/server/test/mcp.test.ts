import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { testEnv } from "./helpers.js";

const SECRET = "test-mcp-secret-0123456789abcdefghijklmnop";
const URL = `/mcp/${SECRET}`;

type RpcResult = { result?: Record<string, unknown>; error?: { code: number; message: string } };

describe("mcp", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let id = 0;
  /** One JSON-RPC request the way ChatGPT sends it (it accepts JSON or an event stream back). */
  const rpc = (method: string, params: object = {}, url = URL) =>
    app.inject({
      method: "POST",
      url,
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: ++id, method, params },
    });
  const result = async (method: string, params?: object) => {
    const res = await rpc(method, params);
    assert.equal(res.statusCode, 200);
    const body = res.json() as RpcResult;
    assert.equal(body.error, undefined);
    return body.result!;
  };
  const callTool = (name: string, args: object = {}) =>
    result("tools/call", { name, arguments: args }) as Promise<{
      content: { type: string; text: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    }>;

  before(async () => {
    app = await buildApp(testEnv({ MCP_SECRET: SECRET }));
  });
  after(() => app.close());

  it("initializes with the team's context as instructions", async () => {
    const res = await result("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal((res.serverInfo as { name: string }).name, "adwise");
    const instructions = res.instructions as string;
    assert.match(instructions, /Today is 2026-10-15/);
    assert.match(instructions, /# The team's glossary/);
    assert.doesNotMatch(instructions, /export_report|follow-ups/);
  });

  it("lists the read-only tools, without the dashboard's export", async () => {
    const { tools } = (await result("tools/list")) as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    assert.deepEqual(
      tools.map((t) => t.name),
      ["get_team_context", "query_metrics", "list_entities", "get_budget_pacing", "get_releases", "get_anomalies"],
    );
    assert.ok(tools.every((t) => t.annotations.readOnlyHint));
  });

  it("answers with the same numbers as the dashboard's metrics", async () => {
    const res = await callTool("query_metrics", { preset: "last_week", metrics: ["spend", "cac"] });
    assert.equal(res.isError, false);
    const totals = res.structuredContent!.totals as { spend: number };
    assert.deepEqual(JSON.parse(res.content[0]!.text), res.structuredContent);

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "marketing", password: "app-password" } });
    const dash = await app.inject({
      method: "POST",
      url: "/metrics/query",
      headers: { authorization: `Bearer ${login.json().data.token}` },
      payload: { preset: "last_week" },
    });
    assert.equal(totals.spend, Math.round(dash.json().data.totals.spend * 100) / 100);
  });

  it("gives the team context as a tool too", async () => {
    const res = await callTool("get_team_context");
    assert.match(res.content[0]!.text, /# The team's notes/);
  });

  it("returns bad arguments as a tool error the assistant can fix", async () => {
    const res = await callTool("query_metrics", { metrics: ["spend"] });
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text, /preset/);
  });

  it("doesn't run the dashboard-only export", async () => {
    const res = await callTool("export_report", { format: "pdf" });
    assert.equal(res.isError, true);
  });

  it("hides behind the secret path", async () => {
    const res = await rpc("tools/list", {}, "/mcp/wrong-secret");
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, "NOT_FOUND");
  });

  it("rejects GET, being stateless", async () => {
    const res = await app.inject({ method: "GET", url: URL });
    assert.equal(res.statusCode, 405);
    assert.equal(res.json().error.code, "METHOD_NOT_ALLOWED");
  });

  it("is off without MCP_SECRET", async () => {
    const off = await buildApp(testEnv());
    const res = await off.inject({ method: "POST", url: URL, payload: {} });
    assert.equal(res.statusCode, 404);
    await off.close();
  });

  it("refuses a short secret at startup", async () => {
    assert.throws(() => testEnv({ MCP_SECRET: "too-short" }), /MCP_SECRET/);
  });
});
