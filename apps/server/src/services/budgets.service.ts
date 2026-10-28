import { PACING_BAND, PACING_DEFAULT_DAYS, PACING_MAX_DAYS } from "../constants/budgets.constant.js";
import type { BudgetsRepository } from "../database/repositories/budgets.repository.js";
import { lastNDays } from "../lib/dates.js";
import { roundCents } from "../lib/money.js";
import { AppError } from "../lib/response.js";
import type { AdSetSpend, BudgetPacing, CampaignPacing, PacingFields, PacingStatus } from "../types/budgets.type.js";
import type { MetricsService } from "./metrics.service.js";

/**
 * Compares each ad set's recent average daily spend with its daily budget.
 * Spend is final the day it's loaded, so every day in the window counts.
 */
export class BudgetsService {
  constructor(
    private readonly repo: BudgetsRepository,
    private readonly metrics: MetricsService,
  ) {}

  /** Pacing over the `days` full days ending yesterday. */
  async pacing(days = PACING_DEFAULT_DAYS): Promise<BudgetPacing> {
    if (!Number.isInteger(days) || days < 1 || days > PACING_MAX_DAYS) {
      throw new AppError(400, "INVALID_DAYS", `days must be an integer from 1 to ${PACING_MAX_DAYS}`);
    }
    const range = lastNDays(days, this.metrics.lastDataDate);
    const rows = await this.repo.adsetSpend(range);

    const adsets = rows.map((r) => ({
      adset_id: r.adset_id,
      adset_name: r.adset_name,
      campaign_id: r.campaign_id,
      status: r.status,
      ...pacingFields(r.daily_budget_usd, r.spend, r.last_day_spend, days, r.status !== "active"),
    }));

    return { range, days, band: { ...PACING_BAND }, adsets, campaigns: rollUpCampaigns(rows, days) };
  }
}

/** Sums the active ad sets of each campaign; a campaign with none active is `paused`. */
function rollUpCampaigns(rows: AdSetSpend[], days: number): CampaignPacing[] {
  const byCampaign = new Map<string, AdSetSpend[]>();
  for (const r of rows) byCampaign.set(r.campaign_id, [...(byCampaign.get(r.campaign_id) ?? []), r]);

  return [...byCampaign.values()].map((group) => {
    const { campaign_id, campaign_name, channel, country } = group[0]!;
    const active = group.filter((r) => r.status === "active");
    const sum = (key: "daily_budget_usd" | "spend" | "last_day_spend") => active.reduce((n, r) => n + r[key], 0);
    return {
      campaign_id,
      campaign_name,
      channel,
      country,
      ...pacingFields(sum("daily_budget_usd"), sum("spend"), sum("last_day_spend"), days, active.length === 0),
    };
  });
}

function pacingFields(
  budget: number,
  spend: number,
  lastDaySpend: number,
  days: number,
  paused: boolean,
): PacingFields {
  const avg = spend / days;
  const pace = budget > 0 ? avg / budget : null;
  return {
    daily_budget_usd: roundCents(budget),
    spend: roundCents(spend),
    avg_daily_spend: roundCents(avg),
    last_day_spend: roundCents(lastDaySpend),
    pace,
    pacing: paused ? "paused" : pacingStatus(pace),
  };
}

function pacingStatus(pace: number | null): PacingStatus {
  if (pace === null) return "on_pace";
  if (pace > PACING_BAND.over) return "over";
  if (pace < PACING_BAND.under) return "under";
  return "on_pace";
}
