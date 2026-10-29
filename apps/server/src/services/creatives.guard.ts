/**
 * Keeps concepts honest. The model only writes words: evidence must cite ids the
 * server produced, and any money or percentage figure in the text must match a
 * number in the measured context (the investigation's check). Whatever fails is
 * removed and counted, never repaired. Exploratory concepts carry no evidence.
 */
import { randomBytes } from "node:crypto";
import type { Static, TSchema } from "typebox";
import Value from "typebox/value";
import { BRIEF_FIELDS, BRIEF_SUGGESTION_LIMITS, CONCEPT_LIMITS, CONCEPTS_MAX, IMAGE_ASPECT_RATIOS, IMAGE_PROMPT_MAX } from "../constants/creatives.constant.js";
import { ModelBrief, ModelConcepts } from "../schemas/creatives.schema.js";
import type { AspectRatio, BriefField, BriefSuggestion, ConceptEvidence, CreativeBrief, CreativeConcept, CreativeContext } from "../types/creatives.type.js";
import { unverifiedFigures } from "./investigation.guard.js";

type Raw = Static<typeof ModelConcepts>;
type RawConcept = Raw["concepts"][number];

/** Parses the model's reply against `schema`: plain JSON, or JSON inside a code fence or surrounding prose. */
export function parseModelJson<T extends TSchema>(schema: T, text: string): { ok: true; value: Static<T> } | { ok: false; error: string } {
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
  if (!Value.Check(schema, value)) {
    const first = Value.Errors(schema, value)[0];
    return { ok: false, error: `Doesn't match the schema${first ? `: ${first.instancePath || "/"} ${first.message}` : ""}` };
  }
  return { ok: true, value: value as Static<T> };
}

export const parseConcepts = (text: string) => parseModelJson(ModelConcepts, text);
export const parseBrief = (text: string) => parseModelJson(ModelBrief, text);

/** Evidence ids a concept may cite, with the label shown next to each. */
export function evidenceLabels(context: CreativeContext | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!context) return out;
  for (const m of context.metrics) out.set(m.evidenceId, m.label);
  for (const a of context.topAds) out.set(a.evidenceId, `${a.name} (${a.adsetName})`);
  return out;
}

/** Every number in the context, as magnitudes, for checking the model's figures. */
export function contextNumbers(context: CreativeContext | null): number[] {
  if (!context) return [];
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(Math.abs(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk({ metrics: context.metrics, topAds: context.topAds });
  return out;
}

export const clip = (text: string, max: number) => {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** Keeps whole sentences up to `max` characters; cuts mid-sentence only when the first one is already too long. */
export function clipSentences(text: string, max: number): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out || clip(text, max);
}

const isRatio = (v: string | undefined): v is AspectRatio => !!v && (IMAGE_ASPECT_RATIOS as readonly string[]).includes(v);

type Guard = { ids: Map<string, string>; numbers: number[]; dataInformed: boolean; removed: number };

/** Drops sentences carrying a figure no fact backs; counts each one. */
function honestText(text: string, g: Guard): string {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => {
    const bad = unverifiedFigures(s, g.numbers).length > 0;
    if (bad) g.removed++;
    return !bad;
  });
  return kept.join(" ");
}

function guardEvidence(items: { evidenceId: string; observation: string }[] | undefined, g: Guard): ConceptEvidence[] {
  const out: ConceptEvidence[] = [];
  for (const item of items ?? []) {
    const id = item.evidenceId.trim();
    const label = g.ids.get(id);
    if (!g.dataInformed || !label) {
      g.removed++;
      continue;
    }
    const observation = honestText(item.observation, g);
    if (!observation) continue;
    out.push({ evidenceId: id, label, observation: clip(observation, CONCEPT_LIMITS.text) });
  }
  return out.slice(0, CONCEPT_LIMITS.listItems);
}

/**
 * Applies the guardrails and the length limits, and gives each concept a server id.
 * `fallbackRatio` replaces a ratio the image model doesn't support.
 */
export function sanitizeConcepts(raw: Raw, context: CreativeContext | null, opts: { dataInformed: boolean; fallbackRatio: AspectRatio }): { concepts: CreativeConcept[]; removed: number } {
  const g: Guard = { ids: evidenceLabels(context), numbers: contextNumbers(context), dataInformed: opts.dataInformed, removed: 0 };
  const concepts = raw.concepts.slice(0, CONCEPTS_MAX).map((c) => sanitizeConcept(c, g, opts.fallbackRatio, `cn_${randomBytes(4).toString("hex")}`));
  return { concepts, removed: g.removed };
}

function sanitizeConcept(c: RawConcept, g: Guard, fallbackRatio: AspectRatio, conceptId: string): CreativeConcept {
  const text = (v: string, max = CONCEPT_LIMITS.text) => clip(honestText(v, g), max);
  const rationale = text(c.creativeRationale);
  return {
    conceptId,
    title: clip(c.title, CONCEPT_LIMITS.title),
    creativeRationale: rationale || (g.dataInformed ? "Rationale removed: it cited figures that aren't in the data." : "Exploratory concept, not based on performance data."),
    targetAudience: text(c.targetAudience),
    coreMessage: text(c.coreMessage),
    visualDescription: clip(c.visualDescription, CONCEPT_LIMITS.text),
    composition: clip(c.composition, CONCEPT_LIMITS.text),
    suggestedHeadline: text(c.suggestedHeadline, CONCEPT_LIMITS.headline) || clip(c.title, CONCEPT_LIMITS.headline),
    suggestedPrimaryText: text(c.suggestedPrimaryText, CONCEPT_LIMITS.primaryText),
    suggestedCallToAction: clip(c.suggestedCallToAction, CONCEPT_LIMITS.callToAction),
    imagePrompt: clip(c.imagePrompt, IMAGE_PROMPT_MAX),
    aspectRatio: isRatio(c.aspectRatio) ? c.aspectRatio : fallbackRatio,
    performanceEvidence: guardEvidence(c.performanceEvidence, g),
    assumptions: (c.assumptions ?? []).map((a) => text(a)).filter(Boolean).slice(0, CONCEPT_LIMITS.listItems),
    testHypothesis: text(c.testHypothesis) || "Test this concept against the current ads and compare CTR, cost per trial and CAC once final.",
  };
}

/**
 * Re-checks a concept the browser sends back to generate an image (the user may
 * have edited it): evidence must still cite this context and its figures must
 * still match. Returns the cleaned evidence and how much was dropped.
 */
export function recheckEvidence(evidence: { evidenceId: string; observation: string }[], context: CreativeContext | null, dataInformed: boolean) {
  const g: Guard = { ids: evidenceLabels(context), numbers: contextNumbers(context), dataInformed, removed: 0 };
  return { evidence: guardEvidence(evidence, g), removed: g.removed };
}

/**
 * Brief suggestions are intent, not measurement: any money or percentage figure
 * removes its sentence (a brief carries no numbers), fields the user already
 * filled and unknown fields are dropped, and each field is suggested once.
 */
export function sanitizeBrief(raw: Static<typeof ModelBrief>, filled: CreativeBrief): { suggestions: BriefSuggestion[]; removed: number } {
  const g: Guard = { ids: new Map(), numbers: [], dataInformed: false, removed: 0 };
  const seen = new Set<BriefField>();
  const suggestions: BriefSuggestion[] = [];
  for (const item of raw.suggestions) {
    const field = item.field.trim() as BriefField;
    if (!(BRIEF_FIELDS as readonly string[]).includes(field) || seen.has(field) || filled[field]?.trim()) {
      g.removed++;
      continue;
    }
    const value = clipSentences(honestText(item.value, g), BRIEF_SUGGESTION_LIMITS.value);
    if (!value) continue;
    seen.add(field);
    const basis = item.basis?.trim().toLowerCase() === "data" ? "data" : "assumption";
    const note = clipSentences(honestText(item.note ?? "", g), BRIEF_SUGGESTION_LIMITS.note);
    suggestions.push({ field, value, basis, note: note || (basis === "data" ? "From the selection's data." : "An assumption: not in the data.") });
  }
  suggestions.sort((a, b) => BRIEF_FIELDS.indexOf(a.field) - BRIEF_FIELDS.indexOf(b.field));
  return { suggestions, removed: g.removed };
}
