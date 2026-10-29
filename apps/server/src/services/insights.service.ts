import { createHash, randomUUID } from "node:crypto";
import {
  INSIGHT_SUMMARY_MAX_CHARS,
  INSIGHT_TITLE_MAX_CHARS,
  INSIGHTS_MAX,
  SNAPSHOT_MAX_TOKEN_CHARS,
  SNAPSHOT_TTL_MS,
} from "../constants/insights.constant.js";
import { JsonList } from "../lib/json-list.js";
import { AppError } from "../lib/response.js";
import type { SnapshotSigner } from "../lib/snapshot.js";
import type { DateRange } from "../types/dates.type.js";
import type {
  DataCaveat,
  Evidence,
  Insight,
  InsightDraft,
  InsightQuery,
  InsightScope,
  InsightSummary,
  MetricNote,
  Snapshot,
} from "../types/insights.type.js";
import type { EntitiesService } from "./entities.service.js";
import type { MetricsService } from "./metrics.service.js";

/** An insight as the API returns it: no source hash, plus whether the caller may change it. */
export type InsightView = Omit<Insight, "sourceHash"> & { mine: boolean };

/**
 * Agent answers saved as reports. An insight is a frozen snapshot: the
 * question, the answer and every lookup's output as the model read it, signed
 * by the agent stream and verified here, so a report never re-runs or changes
 * when it's opened later. Scope (period, filters, campaigns, definitions) and
 * data caveats are read from the evidence, never from the model's wording.
 *
 * Every signed-in teammate can read the library (sharing within the team is the
 * point); only the account that saved an insight can rename or delete it.
 * Saved in a JSON file (INSIGHTS_PATH), like the team rules and pins.
 */
export class InsightsService {
  private constructor(
    private readonly store: JsonList<Insight>,
    private readonly signer: SnapshotSigner,
    private readonly metrics: MetricsService,
    private readonly entities: EntitiesService,
  ) {}

  static async load(path: string, deps: { signer: SnapshotSigner; metrics: MetricsService; entities: EntitiesService }) {
    return new InsightsService(await JsonList.load<Insight>(path, "INSIGHTS_PATH"), deps.signer, deps.metrics, deps.entities);
  }

  /** What saving `token` would store, for the review step. Nothing is written. */
  async preview(token: string): Promise<InsightDraft> {
    const snapshot = this.open(token);
    const scope = await this.scope(snapshot);
    return {
      title: cleanTitle(snapshot.question) || "Saved insight",
      summary: leadSentence(snapshot.answer),
      snapshot,
      scope,
      caveats: caveatsOf(snapshot.evidence),
    };
  }

  async create(input: { token: string; title: string }, owner: string): Promise<InsightView> {
    const title = cleanTitle(input.title);
    if (!title) throw new AppError(400, "EMPTY_TITLE", "Give the insight a title");
    const draft = await this.preview(input.token);
    const sourceHash = createHash("sha256").update(input.token).digest("hex");

    const insight = await this.store.write((items) => {
      if (items.some((i) => i.sourceHash === sourceHash)) {
        throw new AppError(409, "INSIGHT_EXISTS", "This answer is already saved in Insights");
      }
      if (items.length >= INSIGHTS_MAX) {
        throw new AppError(409, "TOO_MANY_INSIGHTS", `The library holds ${INSIGHTS_MAX} insights; delete one first`);
      }
      const now = new Date().toISOString();
      const created: Insight = { id: randomUUID(), ...draft, title, owner, createdAt: now, updatedAt: now, sourceHash };
      return { items: [...items, created], result: created };
    });
    return view(insight, owner);
  }

  list(query: InsightQuery, user: string): InsightSummary[] {
    if (query.from && query.to && query.from > query.to) {
      throw new AppError(400, "INVALID_RANGE", "`from` must be on or before `to`");
    }
    const q = query.q?.trim().toLowerCase();
    const matches = this.store.items.filter((i) => {
      const day = i.createdAt.slice(0, 10);
      if (query.from && day < query.from) return false;
      if (query.to && day > query.to) return false;
      if (!q) return true;
      return [i.title, i.snapshot.question, ...i.scope.campaigns.map((c) => c.name)].some((text) =>
        text.toLowerCase().includes(q),
      );
    });
    // Ids break ties so the order is stable when two were saved in the same millisecond.
    const order = query.sort === "oldest" ? 1 : -1;
    matches.sort((a, b) => order * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
    return matches.map((i) => summaryOf(i, user));
  }

  get(id: string, user: string): InsightView {
    return view(find(this.store.items, id), user);
  }

  /** Only the title changes; the snapshot stays as it was saved. */
  async rename(id: string, title: string, user: string): Promise<InsightView> {
    const clean = cleanTitle(title);
    if (!clean) throw new AppError(400, "EMPTY_TITLE", "Give the insight a title");
    const insight = await this.store.write((items) => {
      const current = owned(items, id, user);
      const renamed: Insight = { ...current, title: clean, updatedAt: new Date().toISOString() };
      return { items: items.map((i) => (i.id === id ? renamed : i)), result: renamed };
    });
    return view(insight, user);
  }

  async remove(id: string, user: string): Promise<InsightView> {
    const insight = await this.store.write((items) => {
      const current = owned(items, id, user);
      return { items: items.filter((i) => i.id !== id), result: current };
    });
    return view(insight, user);
  }

  /** Verifies a snapshot token from the agent stream; a changed, malformed or stale one is refused. */
  private open(token: string): Snapshot {
    const payload = token.length <= SNAPSHOT_MAX_TOKEN_CHARS ? this.signer.verify(token) : null;
    if (!isSnapshot(payload)) {
      throw new AppError(400, "INVALID_SNAPSHOT", "This answer can't be saved: its snapshot is missing or was changed");
    }
    const age = Date.now() - Date.parse(payload.answeredAt);
    if (!(age < SNAPSHOT_TTL_MS)) {
      throw new AppError(400, "SNAPSHOT_EXPIRED", "This answer is too old to save. Ask the question again, then save it");
    }
    return payload;
  }

  private async scope(snapshot: Snapshot): Promise<InsightScope> {
    const ok = snapshot.evidence.filter((e) => e.ok);
    const strings = (key: string) => [
      ...new Set(ok.flatMap((e) => {
        const v = e.args[key];
        return typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      })),
    ];

    const ranges = dedupeRanges(ok.flatMap((e) => [rangeOf(e.data?.range), rangeOf(asRecord(e.data?.previous)?.range)]));
    const period = ranges.length
      ? { from: ranges.map((r) => r.from).sort()[0]!, to: ranges.map((r) => r.to).sort().at(-1)! }
      : null;

    const campaignIds = new Set([...strings("campaign_ids"), ...strings("campaign_id")]);
    const campaigns = campaignIds.size
      ? (await this.entities.list()).campaigns
          .filter((c) => campaignIds.has(c.id))
          .map(({ id, name, channel, country }) => ({ id, name, channel, country }))
      : [];

    return {
      period,
      ranges,
      channels: [...new Set([...strings("channels"), ...strings("channel")])],
      countries: [...new Set([...strings("countries"), ...strings("country")])],
      campaigns,
      metrics: this.metricNotes(snapshot, strings("metrics")),
    };
  }

  /**
   * Definitions for the metrics the lookups asked for. A lookup that asked for
   * all of them falls back to the ones the answer names, so the report doesn't
   * list all nine.
   */
  private metricNotes(snapshot: Snapshot, requested: string[]): MetricNote[] {
    const catalog = this.metrics.catalog().metrics;
    const answer = snapshot.answer.toLowerCase();
    const named = catalog.filter((m) => answer.includes(m.label.toLowerCase()) || answer.includes(m.key.replaceAll("_", " ")));
    const used = requested.length ? catalog.filter((m) => requested.includes(m.key)) : named;
    return used.map((m) => ({
      key: m.key,
      label: m.label,
      unit: m.unit,
      ...(m.formula && { formula: m.formula }),
      finalAfterDays: m.finalAfterDays,
    }));
  }
}

function find(items: Insight[], id: string): Insight {
  const insight = items.find((i) => i.id === id);
  if (!insight) throw new AppError(404, "INSIGHT_NOT_FOUND", "No insight with that id");
  return insight;
}

function owned(items: Insight[], id: string, user: string): Insight {
  const insight = find(items, id);
  if (insight.owner !== user) throw new AppError(403, "FORBIDDEN", "Only the person who saved this insight can change it");
  return insight;
}

/** The source hash is only for spotting duplicates, so it stays on the server. */
function view(insight: Insight, user: string): InsightView {
  const { sourceHash, ...rest } = insight;
  void sourceHash;
  return { ...rest, mine: insight.owner === user };
}

function summaryOf(i: Insight, user: string): InsightSummary {
  return {
    id: i.id,
    title: i.title,
    summary: i.summary,
    owner: i.owner,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    question: i.snapshot.question,
    period: i.scope.period,
    campaigns: i.scope.campaigns.map((c) => c.name),
    model: i.snapshot.model.label,
    evidenceCount: i.snapshot.evidence.length,
    mine: i.owner === user,
  };
}

/** Caveats the data itself carries: young days, cut rows, failed or trimmed lookups. */
function caveatsOf(evidence: Evidence[]): DataCaveat[] {
  const out: DataCaveat[] = [];
  const seen = new Set<string>();
  const add = (c: DataCaveat) => {
    if (!seen.has(c.text)) out.push(c);
    seen.add(c.text);
  };
  for (const e of evidence) {
    if (!e.ok) add({ kind: "lookup_failed", text: `A lookup failed and wasn't used: ${e.label} (${e.summary})` });
    if (e.truncated) add({ kind: "evidence_truncated", text: `${e.label}: the output was too large to keep; only its summary is saved` });
    if (!e.data) continue;
    if (e.tool === "query_metrics") {
      for (const [metric, day] of Object.entries(asRecord(e.data.final_through) ?? {})) {
        if (typeof day === "string") {
          add({ kind: "not_final", text: `${metric} includes install days that weren't final yet; it was final through ${day}` });
        }
      }
    }
    if (typeof e.data.rows_omitted === "number") {
      add({ kind: "rows_omitted", text: `${e.label}: ${e.data.rows_omitted} more rows weren't shown to the agent (totals cover them)` });
    }
  }
  return out;
}

const asRecord = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

function rangeOf(v: unknown): DateRange | null {
  const r = asRecord(v);
  return r && typeof r.from === "string" && typeof r.to === "string" ? { from: r.from, to: r.to } : null;
}

function dedupeRanges(ranges: (DateRange | null)[]): DateRange[] {
  const seen = new Map<string, DateRange>();
  for (const r of ranges) if (r) seen.set(`${r.from}|${r.to}`, r);
  return [...seen.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function cleanTitle(text: string): string {
  const title = text.trim().replace(/\s+/g, " ");
  return title.length > INSIGHT_TITLE_MAX_CHARS ? `${title.slice(0, INSIGHT_TITLE_MAX_CHARS - 1)}…` : title;
}

/** The answer's first sentence without Markdown, for the list. Team answers lead with the answer. */
function leadSentence(text: string): string {
  const plain = text
    .replace(/[*_`#>|]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const end = plain.search(/[.!?](\s|$)/);
  const lead = end === -1 ? plain : plain.slice(0, end + 1);
  return lead.length > INSIGHT_SUMMARY_MAX_CHARS ? `${lead.slice(0, INSIGHT_SUMMARY_MAX_CHARS - 1)}…` : lead;
}

/** A signed payload is ours, so this only guards against a token from an older format. */
function isSnapshot(v: unknown): v is Snapshot {
  const s = asRecord(v);
  return (
    !!s &&
    s.v === 1 &&
    typeof s.answeredAt === "string" &&
    typeof s.question === "string" &&
    typeof s.answer === "string" &&
    Array.isArray(s.evidence) &&
    Array.isArray(s.notes) &&
    Array.isArray(s.earlierQuestions)
  );
}
