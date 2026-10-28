import type { AdSetSpend } from "../../types/budgets.type.js";
import type { DateRange } from "../../types/dates.type.js";
import type { Database } from "../connection.js";

/** Ad set budgets next to what they spent. */
export class BudgetsRepository {
  constructor(private readonly db: Database) {}

  /** Every ad set with its spend in `range` and on `range.to`; 0 when it spent nothing. */
  async adsetSpend(range: DateRange): Promise<AdSetSpend[]> {
    const spendByAd = (where: { gte: string; lte: string }) =>
      this.db.adDaily.groupBy({ by: ["adId"], where: { date: where }, _sum: { spendUsd: true } });

    const [adsets, inRange, lastDay] = await Promise.all([
      this.db.adSet.findMany({
        include: { campaign: true, ads: { select: { id: true } } },
        orderBy: [{ campaignId: "asc" }, { name: "asc" }],
      }),
      spendByAd({ gte: range.from, lte: range.to }),
      spendByAd({ gte: range.to, lte: range.to }),
    ]);
    const total = (rows: typeof inRange, adIds: string[]) => {
      const byAd = new Map(rows.map((r) => [r.adId, r._sum.spendUsd ?? 0]));
      return adIds.reduce((sum, id) => sum + (byAd.get(id) ?? 0), 0);
    };

    return adsets.map((s) => {
      const adIds = s.ads.map((a) => a.id);
      return {
        adset_id: s.id,
        adset_name: s.name,
        status: s.status,
        daily_budget_usd: s.dailyBudgetUsd,
        campaign_id: s.campaign.id,
        campaign_name: s.campaign.name,
        channel: s.campaign.channel,
        country: s.campaign.country,
        spend: total(inRange, adIds),
        last_day_spend: total(lastDay, adIds),
      };
    });
  }
}
