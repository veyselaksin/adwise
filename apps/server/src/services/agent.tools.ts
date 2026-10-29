import Type, { type Static, type TObject } from "typebox";
import Value from "typebox/value";
import { AGENT_MAX_TOOL_ROWS } from "../constants/agent.constant.js";
import { ANOMALY_TOOL_MAX_ROWS, ANOMALY_TYPES } from "../constants/anomalies.constant.js";
import { DATE_PATTERN } from "../constants/dates.constant.js";
import { EXPORT_DEFAULT_PRESET, EXPORT_FORMAT_LABELS, EXPORT_FORMATS, EXPORT_TABLES } from "../constants/export.constant.js";
import { METRIC_KEYS, METRICS } from "../constants/metrics.constant.js";
import { toToolSchema } from "../lib/tool-schema.js";
import { roundCents } from "../lib/money.js";
import { AppError } from "../lib/response.js";
import { literals } from "../schemas/common.schema.js";
import { Dimension, MetricKey, RangePreset } from "../schemas/metrics.schema.js";
import type { ExportRequest, ToolDeclaration } from "../types/agent.type.js";
import type { DimensionFields, MetricKey as MetricKeyType, MetricRow, MetricsRequest } from "../types/metrics.type.js";
import type { AnomaliesService } from "./anomalies.service.js";
import type { BudgetsService } from "./budgets.service.js";
import type { EntitiesService } from "./entities.service.js";
import type { MetricsService } from "./metrics.service.js";
import type { ReleasesService } from "./releases.service.js";

export type ToolDeps = {
  metrics: MetricsService;
  entities: EntitiesService;
  budgets: BudgetsService;
  releases: ReleasesService;
  anomalies: AnomaliesService;
};

/**
 * What a tool hands back: `data` goes to the model, `summary` to the user's step
 * list, and `export` (export_report only) to the dashboard as a download.
 */
export type ToolOutput = {
  ok: boolean;
  summary: string;
  data: Record<string, unknown>;
  export?: ExportRequest;
  /** Why it failed, as a stable code (an AppError's code, INVALID_ARGUMENTS, UNKNOWN_TOOL); for telemetry. */
  code?: string;
};

type Tool<S extends TObject> = {
  name: string;
  description: string;
  params: S;
  /** Only in the dashboard's agent, not over MCP (the result is a dashboard download). */
  dashboardOnly?: boolean;
  /** One line for the step list, e.g. "CAC by ad set · US · 2026-10-01 → 2026-10-11". */
  label: (args: Static<S>) => string;
  run: (args: Static<S>, deps: ToolDeps) => Promise<ToolOutput>;
};

const tool = <S extends TObject>(t: Tool<S>) => t;

const isoDate = (description: string) => Type.Optional(Type.String({ pattern: DATE_PATTERN, description }));
const list = (description: string) => Type.Optional(Type.Array(Type.String(), { maxItems: 50, description }));

/* ---------------------------------------------------------------- metrics */

export const QueryMetricsParams = Type.Object({
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

export type QueryMetricsArgs = Static<typeof QueryMetricsParams>;

/**
 * The metric layer's request for a query_metrics call. Pinned tiles store the
 * call's arguments and re-run them through this, so a tile shows exactly what
 * the agent looked up, with its period resolved again each time.
 */
export function metricsRequestFrom(a: QueryMetricsArgs): MetricsRequest {
  if (!a.preset && !(a.from && a.to)) {
    throw new AppError(400, "MISSING_RANGE", "Give `preset`, or both `from` and `to`.");
  }
  return {
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
  };
}

const queryMetrics = tool({
  name: "query_metrics",
  description: [
    "Ad performance from the warehouse: spend, funnel counts and the glossary's derived metrics (CPI, CAC, cost per trial, trial → sub, D7 ROAS, CTR), summed over a period and optionally split.",
    "Derived metrics are ratios of sums, so always read them from here instead of averaging rows.",
    "`totals` is the blended number over every row (also when `limit` cuts the rows).",
    "`not_final` lists metrics that include install days too young to be final; `final_through` says the last final day for those, so you can re-query up to it.",
    "Ratios (trial_to_sub, d7_roas, ctr) are percentages already rounded to one decimal: 40.1 means 40.1%. Quote them as they are.",
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
    const res = await metrics.run(metricsRequestFrom(a));

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

/**
 * Drops empty dimensions and unrequested metrics, and rounds the way the team
 * reads numbers (ratios become percentages), so the model quotes instead of re-rounding.
 */
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
  return unit === "usd" ? roundCents(value) : unit === "ratio" ? Math.round(value * 1000) / 10 : value;
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

/* -------------------------------------------------------------- anomalies */

const AnomaliesParams = Type.Object({
  from: isoDate("First day to check, YYYY-MM-DD (with `to`; both omitted = the last 14 days)"),
  to: isoDate("Last day to check, YYYY-MM-DD"),
  channel: Type.Optional(literals(["meta", "tiktok"])),
  country: Type.Optional(literals(["US", "GB", "DE", "BR"])),
  type: Type.Optional(literals(ANOMALY_TYPES, { description: "Only this rule" })),
  campaign_id: Type.Optional(Type.String({ description: "Only this campaign's anomalies" })),
  date: isoDate("Only anomalies on this day"),
});

const getAnomalies = tool({
  name: "get_anomalies",
  description: [
    "The anomaly monitor's flags, exactly as the dashboard shows them: days on which a campaign's spend, CAC, D7 ROAS, CTR, CPC or conversions moved unusually far from the median of its own comparable days before (fixed rules, robust z-score, volume floors, team maturity).",
    "Each item has the observed and baseline values, the change, the score, the rule that fired, a caveat when it is capped at low, and the metric's definition.",
    "Quote these figures instead of recomputing them. An anomaly is a signal to investigate, not a cause: check it with query_metrics (e.g. the campaign by ad set or by date) and get_releases before suggesting why.",
    "Ratios (observed, baseline for ctr/d7_roas) are percentages rounded to one decimal; pct_change is a percentage.",
  ].join(" "),
  params: AnomaliesParams,
  label: (a) =>
    [
      `Anomalies${a.type ? ` · ${a.type.replaceAll("_", " ")}` : ""}`,
      a.campaign_id,
      a.channel,
      a.country,
      a.date ?? (a.from && a.to ? `${a.from} → ${a.to}` : "last 14 days"),
    ]
      .filter(Boolean)
      .join(" · "),
  run: async (a, { anomalies }) => {
    // A single day is still checked over its own baseline, so `date` narrows the range itself.
    const range = a.date ? { from: a.date, to: a.date } : { from: a.from, to: a.to };
    const report = await anomalies.report({ ...range, channel: a.channel, country: a.country, type: a.type });
    const items = report.anomalies.filter((x) => !a.campaign_id || x.campaign.id === a.campaign_id);
    const ratio = (unit: string, v: number) => (unit === "ratio" ? Math.round(v * 1000) / 10 : unit === "usd" ? roundCents(v) : v);
    const rows = items.slice(0, ANOMALY_TOOL_MAX_ROWS).map((x) => ({
      id: x.id,
      severity: x.severity,
      type: x.type,
      campaign: `${x.campaign.name} (${x.campaign.id}, ${x.campaign.channel} ${x.campaign.country})`,
      date: x.date,
      metric: x.metricLabel,
      definition: x.definition,
      observed: ratio(x.unit, x.observed),
      baseline: ratio(x.unit, x.baseline),
      pct_change: x.pctChange === null ? null : Math.round(x.pctChange * 1000) / 10,
      robust_z: x.score,
      baseline_days: `${x.baselineWindow.days} ${x.dayType}s, ${x.baselineWindow.from} → ${x.baselineWindow.to}`,
      volume: x.volume,
      rule: x.rule,
      ...(x.caveat && { caveat: x.caveat }),
      ...(x.spend && { spend: { ...x.spend, pctChange: x.spend.pctChange === null ? null : Math.round(x.spend.pctChange * 1000) / 10 } }),
    }));
    return {
      ok: true,
      summary: `${items.length} anomal${items.length === 1 ? "y" : "ies"} · ${report.summary.bySeverity.high} high`,
      data: {
        range: report.range,
        anomalies: rows,
        ...(items.length > rows.length && { rows_omitted: items.length - rows.length }),
        final_through: report.finalThrough,
        checks_skipped: report.coverage.skipped,
      },
    };
  },
});

/* ----------------------------------------------------------------- export */

const ExportReportParams = Type.Object({
  format: literals(EXPORT_FORMATS, { description: "pdf, xlsx (Excel), csv, json or md (Markdown tables the user can copy)" }),
  preset: Type.Optional({
    ...RangePreset,
    description: `A named period. Use this or from/to; with neither, the dashboard's default (${EXPORT_DEFAULT_PRESET}).`,
  }),
  from: isoDate("First day, YYYY-MM-DD (with `to`, instead of preset)"),
  to: isoDate("Last day, YYYY-MM-DD, inclusive"),
  channel: Type.Optional(literals(["meta", "tiktok"], { description: "One channel; both when omitted" })),
  country: Type.Optional(literals(["US", "GB", "DE", "BR"], { description: "One country; all when omitted" })),
  tables: Type.Optional(
    Type.Array(literals(EXPORT_TABLES), {
      minItems: 1,
      maxItems: EXPORT_TABLES.length,
      description:
        "Only these report tables: kpis (headline totals), daily (trend), countries (channels within each country), campaigns, adsets, ads. All when omitted. CSV holds one table: ads unless you pass a single other one.",
    }),
  ),
});

const exportReport = tool({
  name: "export_report",
  description: [
    "Prepares a file of the dashboard overview (PDF, Excel, CSV, JSON or Markdown) and shows the user a download button under your answer (Markdown also gets a copy button). Use it whenever the user asks to export, download or send them a file.",
    "It holds the same tables and numbers as the dashboard for that period, channel and country; it can't be limited to single campaigns, ad sets or ads, nor to other metrics.",
    "No data comes back to you: afterwards say in one sentence what the file holds (format, period, filters), not the numbers.",
  ].join(" "),
  params: ExportReportParams,
  dashboardOnly: true,
  label: (a) =>
    [
      `Export ${EXPORT_FORMAT_LABELS[a.format]}`,
      a.from && a.to ? `${a.from} → ${a.to}` : (a.preset ?? EXPORT_DEFAULT_PRESET).replaceAll("_", " "),
      a.channel,
      a.country,
      a.tables?.join(", "),
    ]
      .filter(Boolean)
      .join(" · "),
  run: async (a) => {
    if (!a.preset && (a.from || a.to)) {
      if (!(a.from && a.to)) throw new AppError(400, "MISSING_RANGE", "Give both `from` and `to`, or a `preset`.");
      if (a.from > a.to) throw new AppError(400, "INVALID_RANGE", "`from` must not be after `to`.");
    }
    const range = a.preset ? { preset: a.preset } : a.from && a.to ? { from: a.from, to: a.to } : { preset: EXPORT_DEFAULT_PRESET };
    const request: ExportRequest = {
      format: a.format,
      ...range,
      ...(a.channel && { channel: a.channel }),
      ...(a.country && { country: a.country }),
      ...(a.tables?.length && { tables: [...new Set(a.tables)] }),
    };
    return {
      ok: true,
      summary: "Download ready",
      data: { status: "A download button for this file is shown under your answer.", file: request },
      export: request,
    };
  },
});

/* ------------------------------------------------------------------ index */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each entry keeps its own params type
const TOOLS: Tool<any>[] = [queryMetrics, listEntities, budgetPacing, getReleases, getAnomalies, exportReport];

export const TOOL_DECLARATIONS: ToolDeclaration[] = TOOLS.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: toToolSchema(t.params as unknown as Record<string, unknown>),
  },
}));

/** The tools an outside assistant gets over MCP: all but the dashboard-only ones. */
export const MCP_TOOL_DECLARATIONS = TOOL_DECLARATIONS.filter(
  (d) => !TOOLS.find((t) => t.name === d.function.name)!.dashboardOnly,
);

/** Validates the model's arguments and runs the tool. Bad input comes back as an error the model can fix. */
export async function runTool(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<ToolOutput> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { ok: false, code: "UNKNOWN_TOOL", summary: "Unknown tool", data: { error: `No tool named ${name}` } };
  if (!Value.Check(t.params, args)) {
    const problems = [...Value.Errors(t.params, args)].slice(0, 3).map((e) => `${e.instancePath || "args"}: ${e.message}`);
    return { ok: false, code: "INVALID_ARGUMENTS", summary: "Invalid arguments", data: { error: problems.join("; ") } };
  }
  try {
    return await t.run(args, deps);
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, summary: err.message, data: { error: err.message } };
    throw err;
  }
}

/** One line for the step list; the tool's name when the arguments don't validate. */
export function toolLabel(name: string, args: Record<string, unknown>): string {
  const t = TOOLS.find((x) => x.name === name);
  return t && Value.Check(t.params, args) ? t.label(args) : name;
}
