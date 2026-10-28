/**
 * Asks the real agent the case's five example questions plus our own, and
 * checks each answer for the numbers and caveats it must contain. Expected
 * numbers for our own questions come from the same services the dashboard
 * uses, so a pass also means the agent and the dashboard agree.
 *
 *   pnpm --filter server eval              # every case
 *   pnpm --filter server eval -- --only 1,4 # some cases
 *
 * Needs GEMINI_API_KEY in .env. Each case costs a few model calls.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import type { Services } from "../src/plugins/services.js";
import type { AgentEvent, ChatMessage } from "../src/types/agent.type.js";
import type { MetricsQuery } from "../src/types/metrics.type.js";

type Check = string | RegExp;

type Case = {
  id: number;
  /** Asked in order, each answer fed back as history (follow-ups). */
  ask: string[];
  expect: Check[];
  /** Must hold for the answer's first paragraph (the team leads with the answer). */
  lead?: Check[];
  /** Must not appear anywhere. */
  reject?: Check[];
  /** Any other problems with the answer, e.g. figures that don't match the data. */
  verify?: (answer: string, s: Services) => Promise<string[]>;
  /** Expected values worked out from the services at run time. */
  computed?: (s: Services) => Promise<Check[]>;
};

const usd = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const count = (n: number) => n.toLocaleString("en-US");
const totals = async (s: Services, q: MetricsQuery) => (await s.metrics.query(q)).totals;

/** Wrong for every answer: the data is all 2026. */
const REJECT_ALWAYS: Check[] = [/\b2025\b/];

const CASES: Case[] = [
  // The case's reference answers (examples/*.md).
  {
    id: 1,
    ask: ["What was our spend on each channel last week?"],
    expect: ["$37,142.36", "$24,414.14", "$61,556.50"],
  },
  {
    id: 2,
    ask: ["Which US ad set had the lowest CAC over the last 14 days?"],
    expect: ["US_Broad_02", "$40.94", /not (yet )?final|still (coming|converting)|trials? (end|are still)/i],
  },
  {
    id: 3,
    ask: ["How did the trial-to-subscription rate on TikTok change month over month?"],
    expect: ["40.1%", "38.9%"],
  },
  {
    id: 4,
    ask: ["Why did CAC go up yesterday?"],
    expect: ["$12.23", "$12.02", /cost per trial/i],
    lead: [/not (yet )?final|(haven't|not) (yet )?(arrived|come in)|still (coming|converting|arriving)|(not|haven't) (yet )?finished|timing|didn't really/i],
  },
  {
    id: 5,
    ask: ["Is TikTok cheaper than Meta for us right now?"],
    expect: [/Brazil|\bBR\b/, "$46.73", "$52.48", "$14.27", "$16.14"],
    lead: [/^\W*no\b/i],
  },
  // Our own: maturity, follow-ups, pacing, and what the data can't answer.
  {
    id: 6,
    ask: ["What was CAC on Oct 13?"],
    expect: [/not (yet )?final|still (coming|converting)/i, /cost per trial/i],
    computed: async (s) => [usd((await totals(s, { range: { from: "2026-10-13", to: "2026-10-13" } })).cost_per_trial)],
  },
  {
    id: 7,
    ask: ["What was total spend in the last 7 days?"],
    computed: async (s) => [usd((await totals(s, { range: { from: "2026-10-08", to: "2026-10-14" } })).spend)],
    expect: [],
  },
  {
    id: 8,
    ask: ["How many subscriptions did GB get in September?"],
    computed: async (s) => [
      count((await totals(s, { range: { from: "2026-09-01", to: "2026-09-30" }, filters: { countries: ["GB"] } })).subscriptions),
    ],
    expect: [],
  },
  {
    id: 9,
    ask: ["What was Meta's D7 ROAS last week?"],
    computed: async (s) => [
      pct((await totals(s, { range: { from: "2026-10-05", to: "2026-10-11" }, filters: { channels: ["meta"] } })).d7_roas),
    ],
    expect: [],
  },
  {
    id: 10,
    ask: ["What did we spend on Meta last week?", "And on TikTok?"],
    expect: ["$24,414.14"],
  },
  {
    id: 11,
    ask: ["Which ad sets are pacing over budget?"],
    computed: async (s) =>
      (await s.budgets.pacing()).adsets.filter((a) => a.pacing === "over").slice(0, 3).map((a) => a.adset_name),
    expect: [],
  },
  {
    id: 12,
    ask: ["Which iOS release hurt conversion the most this month?"],
    expect: [/\b(no|not|can't|cannot|doesn't|isn't)\b[^.]{0,120}\b(split|separate|broken out|attribut|platform)/i],
    lead: [/\b(no|not|can't|cannot|doesn't|isn't|couldn't)\b/i],
  },
  {
    id: 13,
    ask: ["How was our spend yesterday at 3pm?"],
    expect: [/hour/i],
    // It may give the day's total instead, but no other figure.
    verify: async (answer, s) => {
      const day = usd((await totals(s, { range: { from: "2026-10-14", to: "2026-10-14" } })).spend);
      return (answer.match(/\$[\d,]+\.\d{2}/g) ?? []).filter((f) => f !== day).map((f) => `made-up figure ${f} (day total is ${day})`);
    },
  },
  {
    id: 14,
    ask: ["What's the ROAS of our organic users?"],
    expect: [/organic/i, /\b(no|not|don't|doesn't|only)\b/i],
    reject: [/\$\d|\d%/],
  },
  {
    id: 15,
    ask: ["Which DE ad set has the best CAC over the last 14 days?"],
    computed: async (s) => {
      const { rows } = await s.metrics.query({
        range: { from: "2026-10-01", to: "2026-10-11" },
        groupBy: ["adset"],
        filters: { countries: ["DE"] },
      });
      const best = rows.filter((r) => r.subscriptions >= 20 && r.cac !== null).sort((a, b) => a.cac! - b.cac!)[0];
      return best?.adset_name ? [best.adset_name] : [];
    },
    expect: [],
  },
];

type Outcome = { id: number; passed: boolean; missing: string[]; answer: string; tools: string[]; steps: number; tokens: number; ms: number; error?: string };

async function runCase(s: Services, c: Case): Promise<Outcome> {
  const agent = s.agent!;
  const history: ChatMessage[] = [];
  const tools: string[] = [];
  let answer = "";
  let error: string | undefined;
  let steps = 0;
  let tokens = 0;
  const started = performance.now();

  for (const question of c.ask) {
    history.push({ role: "user", text: question });
    answer = "";
    for await (const event of agent.chat([...history]) as AsyncGenerator<AgentEvent>) {
      if (event.type === "tool_call") tools.push(event.label);
      if (event.type === "answer") answer = event.text;
      if (event.type === "error") error = `${event.code}: ${event.message}`;
      if (event.type === "done") {
        steps += event.steps;
        tokens += event.usage.inputTokens + event.usage.outputTokens;
      }
    }
    if (!answer) break;
    history.push({ role: "assistant", text: answer });
  }

  const has = (text: string, check: Check) => (typeof check === "string" ? text.includes(check) : check.test(text));
  const lead = answer.split(/\n\s*\n/)[0] ?? "";
  const missing = [
    ...[...c.expect, ...(c.computed ? await c.computed(s) : [])].filter((check) => !has(answer, check)).map(String),
    ...(c.lead ?? []).filter((check) => !has(lead, check)).map((check) => `lead ${check}`),
    ...[...REJECT_ALWAYS, ...(c.reject ?? [])].filter((check) => has(answer, check)).map((check) => `unwanted ${check}`),
    ...(c.verify ? await c.verify(answer, s) : []),
  ];
  return { id: c.id, passed: !!answer && missing.length === 0, missing, answer, tools, steps, tokens, ms: performance.now() - started, ...(error && { error }) };
}

const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1]?.split(",").map(Number))
  : null;
const cases = CASES.filter((c) => !only || only.has(c.id));

const env = loadEnv({ ...process.env, LOG_LEVEL: "error" });
if (!env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY in apps/server/.env to run the eval.");
  process.exit(1);
}
const app = await buildApp(env);
await app.ready();

const outcomes: Outcome[] = [];
for (const [i, c] of cases.entries()) {
  // Spread calls out so the free tier's per-minute limit isn't the thing being tested.
  if (i > 0) await sleep(4000);
  const o = await runCase(app.services, c);
  outcomes.push(o);
  console.log(`\n${o.passed ? "PASS" : "FAIL"}  #${o.id}  ${c.ask.join(" → ")}`);
  console.log(`      ${o.steps} model calls · ${count(o.tokens)} tokens · ${(o.ms / 1000).toFixed(1)}s`);
  for (const t of o.tools) console.log(`      · ${t}`);
  if (o.error) console.log(`      error: ${o.error}`);
  if (o.missing.length) console.log(`      missing: ${o.missing.join(" | ")}`);
  console.log(o.answer.replace(/^/gm, "      > "));
}

const passed = outcomes.filter((o) => o.passed).length;
const tokens = outcomes.reduce((n, o) => n + o.tokens, 0);
console.log(`\n${passed}/${outcomes.length} passed · ${count(tokens)} tokens`);
await app.close();
process.exit(passed === outcomes.length ? 0 : 1);
