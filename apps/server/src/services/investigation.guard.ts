/**
 * Keeps the model's interpretation honest. The model only writes words: every
 * claim must cite evidence ids the server produced, and any money or percentage
 * figure it writes must match a number in the facts. Whatever fails is removed
 * and counted, never repaired.
 */
import type { Static } from "typebox";
import Value from "typebox/value";
import { INTERPRETATION_LIMITS } from "../constants/investigation.constant.js";
import { ModelInterpretation } from "../schemas/investigation.schema.js";
import type { Finding, Interpretation, InvestigationFacts } from "../types/investigation.type.js";

type Raw = Static<typeof ModelInterpretation>;

/** Every evidence id a finding may cite. */
export function evidenceIds(facts: InvestigationFacts): Set<string> {
  const ids = new Set<string>(["daily"]);
  for (const m of facts.metrics) ids.add(m.evidenceId);
  if (facts.drivers.available) for (const d of facts.drivers.items) ids.add(d.evidenceId);
  for (const r of [...facts.adsets.rows, ...facts.ads.rows]) ids.add(r.evidenceId);
  for (const r of facts.releases) ids.add(r.evidenceId);
  return ids;
}

/** Every number in the facts, as magnitudes, for checking the model's figures. */
function factNumbers(facts: InvestigationFacts): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(Math.abs(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  // Commits hold no figures; skipping them keeps the list to the numbers that matter.
  walk({ ...facts, releases: [] });
  return out;
}

/** Money (`$1,234.56`), percentages (`12.3%`) and percentage points (`1.2 pp`). */
const FIGURE = /\$\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(%|pp\b|percentage points?\b)/gi;

/**
 * The money and percentage figures in `text` that no fact backs. A figure matches
 * a fact when it is that fact rounded to the figure's own decimals (ratios as
 * percentages), so "$27.6" and "$28" both match 27.62, but "$30" doesn't.
 */
export function unverifiedFigures(text: string, numbers: number[]): string[] {
  const bad: string[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const money = match[1] !== undefined;
    const digits = (money ? match[1] : match[2])!;
    const value = Number(digits.replace(/,/g, ""));
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    const tolerance = 0.5 * 10 ** -decimals + 1e-9;
    const candidates = money ? numbers : numbers.flatMap((n) => [n * 100, n]);
    if (!candidates.some((c) => Math.abs(c - value) <= tolerance)) bad.push(match[0]);
  }
  return bad;
}

const clip = (text: string, max = INTERPRETATION_LIMITS.chars) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Parses the model's reply: plain JSON, or JSON inside a code fence or surrounding prose. */
export function parseInterpretation(text: string): { ok: true; value: Raw } | { ok: false; error: string } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const body = fenced ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "No JSON object found" };
  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }
  if (!Value.Check(ModelInterpretation, value)) {
    const first = Value.Errors(ModelInterpretation, value)[0];
    return { ok: false, error: `Doesn't match the schema${first ? `: ${first.instancePath || "/"} ${first.message}` : ""}` };
  }
  return { ok: true, value };
}

/**
 * Applies the guardrails: unknown evidence ids are dropped, findings left without
 * evidence are dropped, and any statement with a figure not in the facts is
 * removed. The summary falls back to the server's own overview if nothing survives.
 */
export function sanitizeInterpretation(raw: Raw, facts: InvestigationFacts): Interpretation {
  const ids = evidenceIds(facts);
  const numbers = factNumbers(facts);
  let removed = 0;
  const honest = (text: string) => {
    const ok = unverifiedFigures(text, numbers).length === 0;
    if (!ok) removed++;
    return ok;
  };

  const sentences = raw.summary.split(/(?<=[.!?])\s+/);
  const kept = sentences.map((s) => s.trim()).filter((s) => s && honest(s));
  const summary = kept.length > 0 ? clip(kept.join(" "), INTERPRETATION_LIMITS.summaryChars) : facts.overview;

  const findings: Finding[] = [];
  for (const f of raw.findings) {
    const evidence = [...new Set(f.evidence.map((e) => e.trim()))].filter((e) => ids.has(e));
    if (evidence.length === 0) {
      removed++;
      continue;
    }
    if (!honest(`${f.title} ${f.explanation}`)) continue;
    findings.push({ title: clip(f.title), explanation: clip(f.explanation), evidence, kind: f.kind, confidence: f.confidence });
  }

  const releaseNotes = (raw.releaseNotes ?? [])
    .map((n) => ({ release: n.release.startsWith("release:") ? n.release : `release:${n.release}`, relevance: n.relevance }))
    .filter((n) => {
      const ok = ids.has(n.release) && n.release.startsWith("release:");
      if (!ok) removed++;
      return ok && honest(n.relevance);
    })
    .map((n) => ({ release: n.release, relevance: clip(n.relevance) }));

  const texts = (list: string[] | undefined, max: number) =>
    (list ?? [])
      .map((t) => t.trim())
      .filter((t) => t && honest(t))
      .slice(0, max)
      .map((t) => clip(t));

  return {
    summary,
    findings: findings.slice(0, INTERPRETATION_LIMITS.findings),
    releaseNotes,
    nextSteps: texts(raw.nextSteps, INTERPRETATION_LIMITS.nextSteps),
    limitations: texts(raw.limitations, INTERPRETATION_LIMITS.limitations),
    removed,
  };
}
