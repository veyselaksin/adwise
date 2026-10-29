// Formatting and URL state for the Observability page. Unknown values come
// back as explicit words, never as 0, so "not reported" can't read as "none".

import { OBS_DEFAULT_RANGE, OBS_RANGES, OBS_TABS, type ObsTab } from "@constants/observability";
import type { LogLevel, ObservabilityRange, RunKind, RunQuery, RunStatusFilter } from "@typings/observability";

export const NOT_REPORTED = "Not reported";
export const UNAVAILABLE = "Unavailable";

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const MIB = 1024 * 1024;

/** 850 → "850 ms", 18342 → "18.3 s", 125000 → "2 min 5 s". */
export function formatDuration(ms: number | null, empty = UNAVAILABLE): string {
  if (ms === null) return empty;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60_000);
  return `${min} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export const formatTokens = (n: number | null, empty = NOT_REPORTED) => (n === null ? empty : countFormat.format(n));

/** Model costs are fractions of a cent, so small values keep more digits. Labeled as an estimate by the caller. */
export function formatCost(usd: number | null, empty = UNAVAILABLE): string {
  if (usd === null) return empty;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Bytes → MiB with one decimal ("142.3 MiB"); MiB = 1,048,576 bytes. */
export const formatMiB = (bytes: number | null) => (bytes === null ? UNAVAILABLE : `${(bytes / MIB).toFixed(1)} MiB`);

export const formatRate = (ratio: number | null) => (ratio === null ? UNAVAILABLE : `${(ratio * 100).toFixed(1)}%`);

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min ${seconds % 60} s`;
}

/** Local date and time to the second, e.g. "Oct 29, 14:27:04". */
export const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Chart tick for a bucket start: time of day for short windows, the date for long ones. */
export function formatBucket(iso: string, bucketMs: number): string {
  const d = new Date(iso);
  return bucketMs >= 86_400_000
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : bucketMs >= 6 * 3_600_000
      ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", hour12: false })
      : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const shortId = (id: string) => id.slice(0, 8);

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const intOf = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 0 ? n : undefined;
};

export type ObsState = {
  tab: ObsTab;
  range: ObservabilityRange;
  kind?: RunKind;
  // Runs tab
  status?: RunStatusFilter;
  model?: string;
  tool?: string;
  minMs?: number;
  maxMs?: number;
  q?: string;
  sort?: RunQuery["sort"];
  order?: RunQuery["order"];
  page: number;
  // Logs tab
  level?: LogLevel;
  errorsOnly?: boolean;
  component?: string;
  cid?: string;
  before?: number;
};

/** Reads the page's state from the URL; anything unrecognised falls back to the default. */
export function parseObsState(params: Params): ObsState {
  const tab = OBS_TABS.find((t) => t.value === one(params.tab))?.value ?? "overview";
  const range = OBS_RANGES.find((r) => r.value === one(params.range))?.value ?? OBS_DEFAULT_RANGE;
  const kind = one(params.kind);
  const sort = one(params.sort);
  const order = one(params.order);
  const level = one(params.level);
  const id = (v: string | undefined) => (v && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : undefined);
  return {
    tab,
    range,
    kind: kind === "agent" || kind === "investigation" ? kind : undefined,
    status: one(params.status) as RunStatusFilter | undefined,
    model: one(params.model) || undefined,
    tool: one(params.tool) || undefined,
    minMs: intOf(one(params.minMs)),
    maxMs: intOf(one(params.maxMs)),
    q: id(one(params.q)),
    sort: sort === "durationMs" || sort === "status" || sort === "startedAt" ? sort : undefined,
    order: order === "asc" || order === "desc" ? order : undefined,
    page: Math.max(1, intOf(one(params.page)) ?? 1),
    level: level === "info" || level === "warn" || level === "error" || level === "debug" ? level : undefined,
    errorsOnly: one(params.errorsOnly) === "1" || undefined,
    component: one(params.component) || undefined,
    cid: id(one(params.cid)),
    before: intOf(one(params.before)),
  };
}

/** The URL for a state; defaults are left out so links stay short. */
export function obsHref(state: Partial<ObsState>): string {
  const params = new URLSearchParams();
  const set = (k: string, v: string | number | boolean | undefined) => {
    if (v !== undefined && v !== "" && v !== false) params.set(k, v === true ? "1" : String(v));
  };
  if (state.tab && state.tab !== "overview") set("tab", state.tab);
  if (state.range && state.range !== OBS_DEFAULT_RANGE) set("range", state.range);
  set("kind", state.kind);
  set("status", state.status);
  set("model", state.model);
  set("tool", state.tool);
  set("minMs", state.minMs);
  set("maxMs", state.maxMs);
  set("q", state.q);
  set("sort", state.sort);
  set("order", state.order);
  if (state.page && state.page > 1) set("page", state.page);
  set("level", state.level);
  set("errorsOnly", state.errorsOnly);
  set("component", state.component);
  set("cid", state.cid);
  set("before", state.before);
  return `/observability${params.size ? `?${params}` : ""}`;
}
