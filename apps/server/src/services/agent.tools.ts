import Type, { type Static, type TObject } from "typebox";
import Value from "typebox/value";
import { AGENT_MAX_TOOL_ROWS } from "../constants/agent.constant.js";
import { DATE_PATTERN } from "../constants/dates.constant.js";
import { METRIC_KEYS, METRICS } from "../constants/metrics.constant.js";
import { toGeminiSchema } from "../lib/gemini-schema.js";
import { roundCents } from "../lib/money.js";
import { AppError } from "../lib/response.js";
import { literals } from "../schemas/common.schema.js";
import { Dimension, MetricKey, RangePreset } from "../schemas/metrics.schema.js";
import type { ToolDeclaration } from "../types/agent.type.js";
import type { DimensionFields, MetricKey as MetricKeyType, MetricRow } from "../types/metrics.type.js";
import type { BudgetsService } from "./budgets.service.js";
import type { EntitiesService } from "./entities.service.js";
import type { MetricsService } from "./metrics.service.js";
import type { ReleasesService } from "./releases.service.js";

export type ToolDeps = {
  metrics: MetricsService;
  entities: EntitiesService;
  budgets: BudgetsService;
  releases: ReleasesService;
};

/** What a tool hands back: `data` goes to the model, `summary` to the user's step list. */
export type ToolOutput = { ok: boolean; summary: string; data: Record<string, unknown> };

type Tool<S extends TObject> = {
  name: string;
  description: string;
  params: S;
  /** One line for the step list, e.g. "CAC by ad set · US · 2026-10-01 → 2026-10-11". */
  label: (args: Static<S>) => string;
  run: (args: Static<S>, deps: ToolDeps) => Promise<ToolOutput>;
};

const tool = <S extends TObject>(t: Tool<S>) => t;

const isoDate = (description: string) => Type.Optional(Type.String({ pattern: DATE_PATTERN, description }));
const list = (description: string) => Type.Optional(Type.Array(Type.String(), { maxItems: 50, description }));

/* ---------------------------------------------------------------- metrics */

const QueryMetricsParams = Type.Object({
  preset: Type.Optional({
    ...RangePreset,
    description: "A named period from the team notes. Use this or from/to.",
  }),
  from: isoDate("First install day, YYYY-MM-DD (with `to`, instead of preset)"),
  to: isoDate("Last install day, YYYY-MM-DD, inclusive"),
  group_by: Type.Optional(
    Type.Array(Dimension, {
      maxItems: 4,
      description: "Split rows by these. adset/ad rows also carry their names, campaign, channel and country.",
    }),
  ),
  metrics: Type.Optional(
    Type.Array(MetricKey, { description: "Only return these metrics (smaller result). Default: all of them." }),
  ),
  channels: list("meta and/or tiktok"),
  countries: list("US, GB, DE, BR"),
  campaign_ids: list("Campaign ids from list_entities"),
  adset_ids: list("Ad set ids from list_entities"),
  ad_ids: list("Ad ids from list_entities"),
  creative_types: list("video and/or image"),
  ad_status: Type.Optional(literals(["active", "paused"], { description: "Current ad status" })),
  order_by: Type.Optional({ ...MetricKey, description: "Sort rows by this metric (time groupings sort by time first)" }),
  order_direction: Type.Optional(literals(["asc", "desc"], { description: "Default desc" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: AGENT_MAX_TOOL_ROWS, description: "Max rows returned" })),
  compare: Type.Optional(Type.Boolean({ description: "Also return totals for the previous period of the same length" })),
});

const queryMetrics = tool({
  name: "query_metrics",
  description: [
    "Ad performance from the warehouse: spend, funnel counts and the glossary's derived metrics (CPI, CAC, cost per trial, trial → sub, D7 ROAS, CTR), summed over a period and optionally split.",
    "Derived metrics are ratios of sums, so always read them from here instead of averaging rows.",
    "`totals` is the blended number over every row (also when `limit` cuts the rows).",
    "`not_final` lists metrics that include install days too young to be final; `final_through` says the last final day for those, so you can re-query up to it.",
    "Ratios (trial_to_sub, d7_roas, ctr) are fractions: 0.401 means 40.1%.",
  ].join(" "),
  params: QueryMetricsParams,
  label: (a) => {
    const what = a.metrics?.length ? a.metrics.join(", ") : "All metrics";
    const by = a.group_by?.length ? ` by ${a.group_by.join(", ")}` : "";
    const filters = [a.channels, a.countries, a.creative_types, a.ad_status && [a.ad_status]]
      .flatMap((f) => f ?? [])
      .concat(countIds(a.campaign_ids, "campaign"), countIds(a.adset_ids, "ad set"), countIds(a.ad_ids, "ad"));
    const period = a.preset ? a.preset.replaceAll("_", " ") : `${a.from ?? "?"} → ${a.to ?? "?"}`;
    return [`${what}${by}`, ...(filters.length ? [filters.join(", ")] : []), period, ...(a.compare ? ["vs previous"] : [])].join(" · ");
  },
  run: async (a, { metrics }) => {
    if (!a.preset && !(a.from && a.to)) {
      throw new AppError(400, "MISSING_RANGE", "Give `preset`, or both `from` and `to`.");
    }
    const res = await metrics.run({
      ...(a.preset ? { preset: a.preset } : { range: { from: a.from!, to: a.to! } }),
      groupBy: a.group_by,
      filters: {
        channels: a.channels,
        countries: a.countries,
        campaignIds: a.campaign_ids,
        adsetIds: a.adset_ids,
        adIds: a.ad_ids,
        creativeTypes: a.creative_types,
        adStatus: a.ad_status,
      },
      orderBy: a.order_by ? { metric: a.order_by, direction: a.order_direction ?? "desc" } : undefined,
      compare: a.compare,
    });

    const keys = a.metrics?.length ? a.metrics : METRIC_KEYS;
    const limit = a.limit ?? AGENT_MAX_TOOL_ROWS;
    const rows = res.rows.slice(0, limit).map((r) => compactRow(r, keys));
    const notFinal = keys.filter((k) => res.totals.provisional.includes(k));
    return {
      ok: true,
      summary: `${res.rows.length} row${res.rows.length === 1 ? "" : "s"} · total spend ${usd.format(res.totals.spend)}`,
      data: {
        range: res.range,
        group_by: res.groupBy,
        rows,
        ...(res.rows.length > rows.length && { rows_omitted: res.rows.length - rows.length }),
        totals: compactRow(res.totals, keys),
        ...(notFinal.length > 0 && {
          final_through: Object.fromEntries(notFinal.map((k) => [k, metrics.lastFinalDate(k)])),
        }),
        ...(res.previous && { previous: { range: res.previous.range, totals: compactRow(res.previous.totals, keys) } }),
      },
    };
  },
});

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Drops empty dimensions and unrequested metrics, and rounds the way the team reads numbers. */
function compactRow(row: MetricRow, keys: MetricKeyType[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row) as [keyof DimensionFields, unknown][]) {
    if (typeof v === "string") out[k] = v;
  }
  for (const k of keys) out[k] = round(k, row[k]);
  const notFinal = row.provisional.filter((k) => keys.includes(k));
  if (notFinal.length > 0) out.not_final = notFinal;
  return out;
}

function round(key: MetricKeyType, value: number | null): number | null {
  if (value === null) return null;
  const { unit } = METRICS[key];
  return unit === "usd" ? roundCents(value) : unit === "ratio" ? Math.round(value * 1e4) / 1e4 : value;
}

const countIds = (ids: string[] | undefined, noun: string) =>
  ids?.length ? [ids.length === 1 ? ids[0]! : `${ids.length} ${noun}s`] : [];

/* --------------------------------------------------------------- entities */

const ListEntitiesParams = Type.Object({
  level: literals(["campaign", "adset", "ad"], { description: "Which level to list" }),
  channel: Type.Optional(literals(["meta", "tiktok"])),
  country: Type.Optional(literals(["US", "GB", "DE", "BR"])),
  status: Type.Optional(literals(["active", "paused"], { description: "Current status" })),
});

const listEntities = tool({
  name: "list_entities",
  description:
    "Campaigns, ad sets or ads with their ids, names, parents, current status and settings (ad sets: current daily budget; ads: creative type and launch date). Use it to turn names the user mentions into ids for query_metrics, and to check what is paused.",
  params: ListEntitiesParams,
  label: (a) =>
    [`${{ campaign: "Campaigns", adset: "Ad sets", ad: "Ads" }[a.level]}`, a.channel, a.country, a.status]
      .filter(Boolean)
      .join(" · "),
  run: async (a, { entities }) => {
    const { campaigns, adsets, ads } = await entities.list();
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));
    const adsetById = new Map(adsets.map((s) => [s.id, s]));
    const keep = (c: { channel: string; country: string } | undefined, status: string) =>
      !!c && (!a.channel || c.channel === a.channel) && (!a.country || c.country === a.country) && (!a.status || status === a.status);

    const items =
      a.level === "campaign"
        ? campaigns.filter((c) => keep(c, c.status))
        : a.level === "adset"
          ? adsets.flatMap((s) => {
              const c = campaignById.get(s.campaign_id);
              return keep(c, s.status)
                ? [{ id: s.id, name: s.name, status: s.status, daily_budget_usd: s.daily_budget_usd, campaign: c!.name, channel: c!.channel, country: c!.country }]
                : [];
            })
          : ads.flatMap((ad) => {
              const s = adsetById.get(ad.adset_id);
              const c = s && campaignById.get(s.campaign_id);
              return keep(c, ad.status)
                ? [{ id: ad.id, name: ad.name, status: ad.status, creative_type: ad.creative_type, launched: ad.created_at, adset: s!.name, adset_id: s!.id, channel: c!.channel, country: c!.country }]
                : [];
            });
    return { ok: true, summary: `${items.length} found`, data: { items } };
  },
});

/* ---------------------------------------------------------------- budgets */

const BudgetPacingParams = Type.Object({
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 14, description: "Full days ending yesterday. Default 7." })),
});

const budgetPacing = tool({
  name: "get_budget_pacing",
  description:
    "Each ad set's average daily spend over the last N full days against its current daily budget, plus campaign sums. pace = avg ÷ budget; outside 0.9–1.1 is flagged over/under. Only current budgets exist, so this can't be run for older periods.",
  params: BudgetPacingParams,
  label: (a) => `Budget pacing · last ${a.days ?? 7} days`,
  run: async (a, { budgets }) => {
    const res = await budgets.pacing(a.days);
    const flagged = res.adsets.filter((s) => s.pacing === "over" || s.pacing === "under").length;
    return { ok: true, summary: `${flagged} of ${res.adsets.length} ad sets off pace`, data: res };
  },
});

/* --------------------------------------------------------------- releases */

const ReleasesParams = Type.Object({
  from: isoDate("First release day, YYYY-MM-DD"),
  to: isoDate("Last release day, YYYY-MM-DD"),
  platform: Type.Optional(literals(["ios", "android"])),
});

const getReleases = tool({
  name: "get_releases",
  description:
    "App releases (iOS and Android) from the build logs, with every commit's type, scope, title and message. Use it when asking why a metric moved. The ad data has no iOS/Android split, so releases can only be lined up with metrics by date; say so instead of claiming a cause.",
  params: ReleasesParams,
  label: (a) => ["Release notes", a.platform, a.from || a.to ? `${a.from ?? "start"} → ${a.to ?? "end"}` : "all"].filter(Boolean).join(" · "),
  run: async (a, { releases }) => {
    const items = releases.list({ range: { from: a.from, to: a.to }, platform: a.platform });
    const commits = items.reduce((n, r) => n + r.commits.length, 0);
    return { ok: true, summary: `${items.length} releases, ${commits} commits`, data: { releases: items } };
  },
});

/* ------------------------------------------------------------------ index */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each entry keeps its own params type
const TOOLS: Tool<any>[] = [queryMetrics, listEntities, budgetPacing, getReleases];

export const TOOL_DECLARATIONS: ToolDeclaration[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: toGeminiSchema(t.params as unknown as Record<string, unknown>),
}));

/** Validates the model's arguments and runs the tool. Bad input comes back as an error the model can fix. */
export async function runTool(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<ToolOutput> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { ok: false, summary: "Unknown tool", data: { error: `No tool named ${name}` } };
  if (!Value.Check(t.params, args)) {
    const problems = [...Value.Errors(t.params, args)].slice(0, 3).map((e) => `${e.instancePath || "args"}: ${e.message}`);
    return { ok: false, summary: "Invalid arguments", data: { error: problems.join("; ") } };
  }
  try {
    return await t.run(args, deps);
  } catch (err) {
    if (err instanceof AppError) return { ok: false, summary: err.message, data: { error: err.message } };
    throw err;
  }
}

/** One line for the step list; the tool's name when the arguments don't validate. */
export function toolLabel(name: string, args: Record<string, unknown>): string {
  const t = TOOLS.find((x) => x.name === name);
  return t && Value.Check(t.params, args) ? t.label(args) : name;
}
