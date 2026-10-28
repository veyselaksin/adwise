import {
  BRIEF_CAC_MOVE,
  BRIEF_COST_PER_TRIAL_MOVE,
  BRIEF_MAX_ITEMS,
  BRIEF_MIN_SUBSCRIPTIONS,
  BRIEF_MIN_TRIALS,
  BRIEF_RELEASE_DAYS,
} from "../constants/brief.constant.js";
import { changeOf } from "../lib/compare.js";
import { lastNDays, previousPeriod, resolvePreset } from "../lib/dates.js";
import { pct, shortDay, shortRange, signedPct, usd } from "../lib/format.js";
import type { Brief, BriefItem } from "../types/brief.type.js";
import type { MetricRow } from "../types/metrics.type.js";
import type { BudgetsService } from "./budgets.service.js";
import type { MetricsService } from "./metrics.service.js";
import type { ReleasesService } from "./releases.service.js";

const channelName = (c?: string) => (c === "tiktok" ? "TikTok" : "Meta");
const campaignLabel = (r: MetricRow) => `${channelName(r.channel)} ${r.country}`;

/**
 * What the team should know this morning, from fixed checks over the same
 * metric layer as the dashboard (no model): yesterday judged by cost per trial
 * (its CAC isn't final, team note 5), last week's final CAC, each campaign on
 * its own (a campaign is one channel in one country, team note 7), budget
 * pacing and recent releases.
 */
export class BriefService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly budgets: BudgetsService,
    private readonly releases: ReleasesService,
  ) {}

  async brief(): Promise<Brief> {
    const { metrics } = this;
    const date = metrics.lastDataDate;
    const day = { from: date, to: date };
    const week = resolvePreset("last_week", metrics.today);
    const weekBefore = previousPeriod(week);

    const [y, w, wb, yCampaigns, wCampaigns, wbCampaigns, pacing] = await Promise.all([
      metrics.query({ range: day }),
      metrics.query({ range: week }),
      metrics.query({ range: weekBefore }),
      metrics.query({ range: day, groupBy: ["campaign"] }),
      metrics.query({ range: week, groupBy: ["campaign"] }),
      metrics.query({ range: weekBefore, groupBy: ["campaign"] }),
      this.budgets.pacing(),
    ]);
    const days = 7;
    const items: BriefItem[] = [];
    const recent = lastNDays(days, date);

    // Each campaign's cost per trial yesterday against its own last week.
    const weekById = new Map(wCampaigns.rows.map((r) => [r.campaign_id, r]));
    for (const r of yCampaigns.rows) {
      const base = weekById.get(r.campaign_id);
      if (!base || r.trials < BRIEF_MIN_TRIALS) continue;
      const { pctChange } = changeOf(base.cost_per_trial, r.cost_per_trial);
      if (pctChange === null || Math.abs(pctChange) < BRIEF_COST_PER_TRIAL_MOVE) continue;
      items.push({
        id: `cpt:${r.campaign_id}`,
        kind: "cost_per_trial",
        tone: pctChange > 0 ? "bad" : "good",
        title: `${campaignLabel(r)}: cost per trial ${pctChange > 0 ? "up" : "down"} ${pct(Math.abs(pctChange))} yesterday`,
        detail: `${r.campaign_name}: ${usd(r.cost_per_trial)} on ${r.trials} trials, against ${usd(base.cost_per_trial)} for ${shortRange(week)}.`,
        investigate: { campaignId: r.campaign_id!, ...recent },
      });
    }

    // Last week's CAC (final) against the week before, per campaign, on enough subscriptions.
    const beforeById = new Map(wbCampaigns.rows.map((r) => [r.campaign_id, r]));
    for (const r of wCampaigns.rows) {
      const base = beforeById.get(r.campaign_id);
      if (!base || Math.min(r.subscriptions, base.subscriptions) < BRIEF_MIN_SUBSCRIPTIONS) continue;
      const { pctChange } = changeOf(base.cac, r.cac);
      if (pctChange === null || Math.abs(pctChange) < BRIEF_CAC_MOVE) continue;
      items.push({
        id: `cac:${r.campaign_id}`,
        kind: "cac",
        tone: pctChange > 0 ? "bad" : "good",
        title: `${campaignLabel(r)}: last week's CAC ${pctChange > 0 ? "up" : "down"} ${pct(Math.abs(pctChange))}`,
        detail: `${r.campaign_name}: ${usd(r.cac)} on ${r.subscriptions} subscriptions for ${shortRange(week)}, against ${usd(base.cac)} for ${shortRange(weekBefore)}.${r.provisional.includes("cac") ? " Not final yet." : ""}`,
        investigate: { campaignId: r.campaign_id!, ...week },
      });
    }

    for (const s of pacing.adsets) {
      if (s.pacing !== "over" && s.pacing !== "under") continue;
      const campaign = pacing.campaigns.find((c) => c.campaign_id === s.campaign_id);
      items.push({
        id: `pace:${s.adset_id}`,
        kind: "pacing",
        tone: s.pacing === "over" ? "bad" : "info",
        title: `${s.adset_name} is ${s.pacing === "over" ? "overspending" : "underspending"} its budget`,
        detail: `${usd(s.avg_daily_spend)} a day over the last ${pacing.days} days against a ${usd(s.daily_budget_usd)} budget (${Math.round((s.pace ?? 0) * 100)}%)${campaign ? ` · ${campaign.campaign_name}` : ""}.`,
        investigate: { campaignId: s.campaign_id, ...recent },
      });
    }

    for (const r of this.releases.list({ range: lastNDays(BRIEF_RELEASE_DAYS, date) })) {
      const scopes = [...new Set(r.commits.map((c) => c.scope).filter(Boolean))].slice(0, 4);
      items.push({
        id: `release:${r.platform}-${r.version}`,
        kind: "release",
        tone: "info",
        title: `${r.platform === "ios" ? "iOS" : "Android"} ${r.version} shipped ${shortDay(r.date)}`,
        detail: `${r.commits.length} commits${scopes.length ? ` (${scopes.join(", ")})` : ""}. The ad data has no platform split, so it lines up by date only.`,
      });
    }

    const order = { bad: 0, good: 1, info: 2 } as const;
    items.sort((a, b) => order[a.tone] - order[b.tone]);

    const avgDailySpend = w.totals.spend / days;
    const spendMove = changeOf(avgDailySpend, y.totals.spend).pctChange;
    const cptMove = changeOf(w.totals.cost_per_trial, y.totals.cost_per_trial).pctChange;
    const cptWord = cptMove === null ? "" : Math.abs(cptMove) < 0.05 ? ", about flat" : cptMove > 0 ? ", higher" : ", lower";
    const needsLook = items.filter((i) => i.tone === "bad").length;
    const headline = [
      `Yesterday ${usd(y.totals.spend)} was spent (${signedPct(spendMove)} against last week's daily average) at ${usd(y.totals.cost_per_trial)} per trial, against ${usd(w.totals.cost_per_trial)} last week${cptWord}.`,
      ...(y.totals.provisional.includes("cac") ? ["Yesterday's CAC isn't final yet, so cost per trial is the fair read."] : []),
      needsLook === 0 ? "Nothing needs a look." : `${needsLook} ${needsLook === 1 ? "thing needs" : "things need"} a look.`,
    ].join(" ");

    return {
      date,
      week,
      weekBefore,
      cacFinalThrough: metrics.lastFinalDate("cac"),
      yesterday: {
        spend: y.totals.spend,
        trials: y.totals.trials,
        subscriptions: y.totals.subscriptions,
        cost_per_trial: y.totals.cost_per_trial,
        cac: y.totals.cac,
        cacFinal: !y.totals.provisional.includes("cac"),
      },
      baseline: {
        avgDailySpend: Math.round(avgDailySpend * 100) / 100,
        cost_per_trial: w.totals.cost_per_trial,
        cac: w.totals.cac,
        cacFinal: !w.totals.provisional.includes("cac"),
      },
      previousWeekCac: wb.totals.cac,
      headline,
      items: items.slice(0, BRIEF_MAX_ITEMS),
      more: Math.max(0, items.length - BRIEF_MAX_ITEMS),
    };
  }
}
