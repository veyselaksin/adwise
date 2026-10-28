import type { Database } from "../connection.js";
import type { Ad, AdSet, Campaign } from "../../types/entities.type.js";

/** Campaigns, ad sets and ads with their current settings, in the API's field names. */
export class EntitiesRepository {
  constructor(private readonly db: Database) {}

  async campaigns(): Promise<Campaign[]> {
    return this.db.campaign.findMany({
      select: { id: true, name: true, channel: true, country: true, status: true },
      orderBy: [{ channel: "asc" }, { country: "asc" }],
    });
  }

  async adsets(): Promise<AdSet[]> {
    const rows = await this.db.adSet.findMany({ orderBy: [{ campaignId: "asc" }, { name: "asc" }] });
    return rows.map((s) => ({
      id: s.id,
      campaign_id: s.campaignId,
      name: s.name,
      status: s.status,
      daily_budget_usd: s.dailyBudgetUsd,
    }));
  }

  async ads(): Promise<Ad[]> {
    const rows = await this.db.ad.findMany({ orderBy: [{ adSetId: "asc" }, { name: "asc" }] });
    return rows.map((a) => ({
      id: a.id,
      adset_id: a.adSetId,
      name: a.name,
      creative_type: a.creativeType,
      status: a.status,
      created_at: a.createdAt,
    }));
  }
}
