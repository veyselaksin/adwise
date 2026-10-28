import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { openDatabase } from "../src/database/connection.js";
import { MetricsRepository } from "../src/database/repositories/metrics.repository.js";
import { previousPeriod, resolvePreset } from "../src/lib/dates.js";
import { MetricsService } from "../src/services/metrics.service.js";
import type { MetricRow } from "../src/types/metrics.type.js";
import { DB_PATH } from "./helpers.js";

const db = openDatabase(DB_PATH);
const metrics = await MetricsService.create(new MetricsRepository(db));
after(() => db.$disconnect());

const usd = (n: number | null) => (n === null ? null : n.toFixed(2));
const pct = (n: number | null) => (n === null ? null : (n * 100).toFixed(1));
const find = (rows: MetricRow[], match: Partial<MetricRow>) => {
  const row = rows.find((r) => Object.entries(match).every(([k, v]) => r[k as keyof MetricRow] === v));
  assert.ok(row, `no row matching ${JSON.stringify(match)}`);
  return row;
};

describe("calendar", () => {
  it("takes today as the day after the last day in the data", () => {
    assert.equal(metrics.lastDataDate, "2026-10-14");
    assert.equal(metrics.today, "2026-10-15");
  });

  it("resolves the team's named periods", () => {
    const today = metrics.today;
    assert.deepEqual(resolvePreset("yesterday", today), { from: "2026-10-14", to: "2026-10-14" });
    assert.deepEqual(resolvePreset("last_week", today), { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(resolvePreset("last_14_days", today), { from: "2026-10-01", to: "2026-10-14" });
    assert.deepEqual(resolvePreset("this_month", today), { from: "2026-10-01", to: "2026-10-14" });
    assert.deepEqual(resolvePreset("last_month", today), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(previousPeriod({ from: "2026-10-05", to: "2026-10-11" }), {
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });

  it("knows which days are final for each metric", () => {
    assert.equal(metrics.lastFinalDate("spend"), "2026-10-14");
    assert.equal(metrics.lastFinalDate("cac"), "2026-10-11");
    assert.equal(metrics.lastFinalDate("trial_to_sub"), "2026-10-10");
    assert.equal(metrics.lastFinalDate("d7_roas"), "2026-10-08");
  });
});

describe("reference answers", () => {
  it("1. spend by channel last week", async () => {
    const res = await metrics.query({ range: resolvePreset("last_week", metrics.today), groupBy: ["channel"] });
    assert.equal(find(res.rows, { channel: "meta" }).spend, 37142.36);
    assert.equal(find(res.rows, { channel: "tiktok" }).spend, 24414.14);
    assert.equal(res.totals.spend, 61556.5);
  });

  it("2. lowest-CAC US ad set over the final days of the last 14", async () => {
    const res = await metrics.query({
      range: { from: "2026-10-01", to: metrics.lastFinalDate("cac") },
      groupBy: ["adset"],
      filters: { countries: ["US"] },
      orderBy: { metric: "cac", direction: "asc" },
    });
    assert.deepEqual(
      res.rows.map((r) => [r.adset_name, r.channel, usd(r.spend), r.subscriptions, usd(r.cac)]),
      [
        ["US_Broad_02", "meta", "11259.22", 275, "40.94"],
        ["US_LAL_01", "meta", "10928.08", 220, "49.67"],
        ["US_Broad_01", "meta", "9964.67", 196, "50.84"],
        ["US_TT_Broad_01", "tiktok", "7211.56", 129, "55.90"],
      ],
    );
    assert.ok(!res.totals.provisional.includes("cac"));
    assert.ok(res.totals.provisional.includes("d7_roas")); // D7 needs 7 days, so Oct 9–11 still count

    const full = await metrics.query({
      range: { from: "2026-10-01", to: "2026-10-14" },
      groupBy: ["adset"],
      filters: { countries: ["US"] },
      orderBy: { metric: "cac", direction: "asc" },
    });
    assert.equal(full.rows[0]?.adset_name, "US_Broad_02");
    assert.equal(usd(full.rows[0]?.cac ?? null), "49.22");
    assert.ok(full.totals.provisional.includes("cac"));
  });

  it("3. TikTok trial → sub by month, final days only", async () => {
    const query = (to: string) =>
      metrics.query({ range: { from: "2026-09-01", to }, groupBy: ["month"], filters: { channels: ["tiktok"] } });
    const [sep, oct] = (await query(metrics.lastFinalDate("trial_to_sub"))).rows;
    assert.deepEqual([sep?.month, sep?.trials, sep?.trial_conversions, pct(sep?.trial_to_sub ?? null)], [
      "2026-09",
      10512,
      4215,
      "40.1",
    ]);
    assert.deepEqual([oct?.month, oct?.trials, oct?.trial_conversions, pct(oct?.trial_to_sub ?? null)], [
      "2026-10",
      3977,
      1549,
      "38.9",
    ]);

    const octWithRecent = (await query("2026-10-14")).rows[1];
    assert.equal(pct(octWithRecent?.trial_to_sub ?? null), "30.5");
    assert.ok(octWithRecent?.provisional.includes("trial_to_sub"));
  });

  it("4. yesterday's CAC is provisional; cost per trial is the fair comparison", async () => {
    const yesterday = (await metrics.query({ range: resolvePreset("yesterday", metrics.today) })).totals;
    const lastWeek = (await metrics.query({ range: resolvePreset("last_week", metrics.today) })).totals;
    assert.equal(usd(yesterday.cac), "200.25");
    assert.equal(usd(lastWeek.cac), "27.62");
    assert.equal(usd(yesterday.cost_per_trial), "12.23");
    assert.equal(usd(lastWeek.cost_per_trial), "12.02");
    assert.ok(yesterday.provisional.includes("cac"));
    assert.ok(!yesterday.provisional.includes("cost_per_trial"));
  });

  it("5. TikTok vs Meta, country by country, then blended", async () => {
    const range = { from: "2026-09-28", to: "2026-10-11" };
    const byChannel = (await metrics.query({ range, groupBy: ["channel"] })).rows;
    const meta = find(byChannel, { channel: "meta" });
    const tiktok = find(byChannel, { channel: "tiktok" });
    assert.equal(usd(tiktok.cac), "20.28");
    assert.equal(usd(meta.cac), "35.49");
    assert.equal(pct(meta.d7_roas), "87.9");
    assert.equal(pct(tiktok.d7_roas), "66.3");

    const cells = (await metrics.query({ range, groupBy: ["country", "channel"] })).rows;
    const cell = (country: string, channel: string) => find(cells, { country, channel });
    assert.equal(pct(cell("BR", "tiktok").spend / tiktok.spend), "70.2");
    assert.deepEqual(
      [
        ["US", "meta"],
        ["US", "tiktok"],
        ["DE", "meta"],
        ["DE", "tiktok"],
        ["BR", "meta"],
        ["BR", "tiktok"],
        ["GB", "meta"],
      ].map(([country, channel]) => {
        const r = cell(country!, channel!);
        return [country, channel, usd(r.cac), pct(r.d7_roas)];
      }),
      [
        ["US", "meta", "46.73", "86.9"],
        ["US", "tiktok", "52.48", "71.2"],
        ["DE", "meta", "44.35", "78.9"],
        ["DE", "tiktok", "49.56", "67.5"],
        ["BR", "meta", "14.27", "80.9"],
        ["BR", "tiktok", "16.14", "64.8"],
        ["GB", "meta", "35.05", "103.5"],
      ],
    );
    assert.equal(
      cells.find((r) => r.country === "GB" && r.channel === "tiktok"),
      undefined,
    );
  });
});

describe("query behavior", () => {
  it("names each ad together with its ad set, since ad names repeat", async () => {
    const rows = (await metrics.query({ range: { from: "2026-09-03", to: "2026-09-10" }, groupBy: ["ad"] })).rows;
    const dupes = rows.filter((r) => r.ad_name === "Before_After_v4");
    assert.equal(dupes.length, 2);
    assert.notEqual(dupes[0]?.adset_name, dupes[1]?.adset_name);
    assert.ok(dupes.every((r) => r.ad_status && r.creative_type && r.channel && r.country && r.campaign_name));
  });

  it("totals cover every row even when the list is limited", async () => {
    const range = resolvePreset("last_week", metrics.today);
    const all = await metrics.query({ range, groupBy: ["adset"] });
    const top3 = await metrics.query({ range, groupBy: ["adset"], limit: 3 });
    assert.equal(top3.rows.length, 3);
    assert.deepEqual(top3.totals, all.totals);
  });

  it("orders time series by date and flags each day's maturity", async () => {
    const rows = (await metrics.query({ range: { from: "2026-10-09", to: "2026-10-14" }, groupBy: ["date"] })).rows;
    assert.deepEqual(
      rows.map((r) => r.date),
      ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"],
    );
    assert.ok(!rows[2]?.provisional.includes("cac")); // Oct 11 is 4 days old
    assert.ok(rows[3]?.provisional.includes("cac"));
    assert.ok(rows[2]?.provisional.includes("trial_to_sub"));
  });

  it("returns zeroed totals and null ratios when nothing matches", async () => {
    const res = await metrics.query({ range: { from: "2026-08-01", to: "2026-08-02" }, groupBy: ["channel"] });
    assert.deepEqual(res.rows, []);
    assert.equal(res.totals.spend, 0);
    assert.equal(res.totals.cac, null);
  });

  it("binds filter values instead of interpolating them", async () => {
    const res = await metrics.query({
      range: { from: "2026-10-01", to: "2026-10-14" },
      filters: { countries: ["US' OR '1'='1"] },
    });
    assert.equal(res.totals.spend, 0);
  });

  it("opens the data read-only", async () => {
    await assert.rejects(() => db.campaign.updateMany({ data: { status: "paused" } }), /readonly/i);
  });

  it("rejects bad ranges with stable error codes", async () => {
    await assert.rejects(() => metrics.query({ range: { from: "2026-10-14", to: "2026-10-01" } }), {
      code: "INVALID_RANGE",
    });
    await assert.rejects(() => metrics.query({ range: { from: "2026-02-30", to: "2026-03-01" } }), {
      code: "INVALID_DATE",
    });
    await assert.rejects(() => metrics.query({ range: { from: "2026-10-01", to: "2026-10-02" }, limit: 0 }), {
      code: "INVALID_LIMIT",
    });
  });
});
