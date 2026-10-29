import { BRIEF_FIELDS, BRIEF_SUGGESTION_LIMITS, CONCEPT_LIMITS, CONCEPTS_MAX, CONCEPTS_MIN, IMAGE_ASPECT_RATIOS } from "../constants/creatives.constant.js";
import { count, formatDelta, formatValue, shortRange, signedPct, usd, pct } from "../lib/format.js";
import type { AspectRatio, CreativeBrief, CreativeContext } from "../types/creatives.type.js";

/**
 * The concept writer's standing instructions. The measured context and the
 * user's brief go in the user message (`conceptsMessage`), already formatted.
 * The rules here are what keeps the concepts honest about what the data shows.
 */
export function buildConceptsPrompt(today: string, dataInformed: boolean): string {
  const basis = dataInformed
    ? `You get measured performance for one campaign (or one of its ad sets or ads), computed by the server from the ad warehouse. Build the concepts on it where it is relevant.`
    : `There is no usable performance data for these concepts (none was selected, or it has too little delivery). The concepts are EXPLORATORY: leave every \`performanceEvidence\` empty, don't mention metrics, and say in \`creativeRationale\` that it isn't based on performance data.`;

  return `You are ADWISE's creative strategist for Livensa's marketing team. You write ${CONCEPTS_MIN}–${CONCEPTS_MAX} distinct ad creative concepts for paid social (Meta, TikTok). Today is ${today}.

${basis}

# Honesty rules (statements that break them are deleted)
- The measured context and the user's brief are your only sources. Never invent metrics, results, audience demographics, product features, prices, offers, customer testimonials or quotes, brand guidelines, or how earlier creatives performed.
- Every money or percentage figure you write must appear in the context exactly as given there. Prefer citing evidence over repeating figures.
- \`performanceEvidence\` items cite one evidence id from the context (\`metric:…\` or \`ad:…\`) and state only what that line shows. Items with unknown ids are deleted.
- The data shows what happened, not why. Don't claim a creative caused a result, or that a concept will improve performance. Write \`testHypothesis\` as something an A/B test could check ("If …, then … may …; measure … against the current ads"), never as a prediction.
- Example of the right reasoning: if CTR is relatively strong but CAC or install→subscription conversion is weak, you may propose testing stronger alignment between the ad's promise and what users find after the click, as a hypothesis. You may not say the creative caused the weak conversion.
- The warehouse has no audience, creative-content, landing-page or brand data. Anything you assume about those goes in \`assumptions\`. What the user wrote in the brief is their claim: use it, but don't present it as measured.
- Metrics marked "not final" will still change (recent installs haven't converted yet), and anything marked "small sample" is noise-prone: say so if you rely on them.
- Name ads with their ad set (ad names repeat across ad sets).

# The image prompt
- \`imagePrompt\` is sent to a third-party image model. Describe only the picture: subject, setting, lighting, style, camera, composition. Never put metrics, campaign names, ids, budgets or other business data in it.
- Ask for no text, letters, logos or UI copy in the image; the ad copy is added separately. Don't depict real people, celebrities or trademarked products.
- Write it in English, 40–120 words.

# Answer format
Reply with one JSON object and nothing else:
{
  "concepts": [{
    "title": "≤ ${CONCEPT_LIMITS.title} chars",
    "creativeRationale": "2–3 sentences: why this concept, grounded in the cited evidence or labeled exploratory",
    "targetAudience": "who it's for (from the brief, or labeled as an assumption)",
    "coreMessage": "the one idea",
    "visualDescription": "what the image shows",
    "composition": "framing, subject placement, space left for copy",
    "suggestedHeadline": "≤ ${CONCEPT_LIMITS.headline} chars",
    "suggestedPrimaryText": "≤ ${CONCEPT_LIMITS.primaryText} chars, no invented offers or claims",
    "suggestedCallToAction": "≤ ${CONCEPT_LIMITS.callToAction} chars",
    "imagePrompt": "the image model prompt",
    "aspectRatio": one of ${IMAGE_ASPECT_RATIOS.map((r) => `"${r}"`).join(", ")},
    "performanceEvidence": [{ "evidenceId": "metric:ctr", "observation": "what that line shows" }],
    "assumptions": ["what this concept assumes without data"],
    "testHypothesis": "what a test would check, and against what"
  }]
}
Make the concepts genuinely different (angle, visual idea), not variations of one. At most ${CONCEPT_LIMITS.listItems} evidence items and ${CONCEPT_LIMITS.listItems} assumptions per concept.`;
}

const fieldLabels: Record<keyof CreativeBrief, string> = {
  productContext: "Product / campaign context",
  targetAudience: "Target audience",
  desiredMessage: "Desired message",
  brandVoice: "Brand voice",
  visualPreferences: "Visual preferences",
  constraints: "Constraints",
};

/** The selected entity and its measured performance as compact text, every figure formatted the way the team reads it. */
function contextParts(input: { context: CreativeContext | null; dataInformed: boolean; exploratoryReason: string | null }): string[] {
  const { context } = input;
  const parts: string[] = [];

  if (context) {
    const scope = [
      `Campaign: ${context.campaign.name} (${context.campaign.channel === "tiktok" ? "TikTok" : "Meta"}, ${context.campaign.country}, ${context.campaign.status})`,
      context.adset && `Ad set: ${context.adset.name} (${context.adset.status})`,
      context.ad && `Ad: ${context.ad.name} in ad set ${context.adset?.name}, creative type ${context.ad.creativeType} (${context.ad.status})`,
      `Period: ${shortRange(context.range)} (${context.days} days)${context.comparison.available ? `, compared with ${shortRange(context.comparison.range)}` : `; no comparison: ${context.comparison.reason}`}`,
    ].filter(Boolean);
    parts.push(`# Selected entity\n${scope.join("\n")}`);

    if (input.dataInformed) {
      const metrics = context.metrics.map((m) => {
        const flags = [m.kind, m.inGlossary ? null : "not in the glossary", m.provisional.current ? "not final" : null].filter(Boolean).join(", ");
        const prev = context.comparison.available ? ` | previous ${formatValue(m.unit, m.previous)} | change ${formatDelta(m.unit, m.absChange)} (${signedPct(m.pctChange)})` : "";
        return `- ${m.evidenceId} | ${m.label}${m.formula ? ` (${m.formula})` : ""} | ${formatValue(m.unit, m.current)}${prev} | ${flags}`;
      });
      parts.push(`# Measured performance\n${metrics.join("\n")}`);
      if (context.topAds.length > 0) {
        const ads = context.topAds.map(
          (a) =>
            `- ${a.evidenceId} | ${a.name} (ad set ${a.adsetName}) | ${a.creativeType} | ${a.status} | spend ${usd(a.spend)}, impressions ${count(a.impressions)}, CTR ${pct(a.ctr)}, CPI ${usd(a.cpi)}, subs ${count(a.subscriptions)}, CAC ${usd(a.cac)}${a.cacProvisional ? " (not final)" : ""}${a.smallSample ? " | small sample" : ""}`,
        );
        parts.push(`# Ads in this ${context.level === "campaign" ? "campaign" : "ad set"} by spend (names and creative type only; the warehouse has no creative content)\n${ads.join("\n")}`);
      }
      if (context.notes.length > 0) parts.push(`# Notes on the data\n${context.notes.map((n) => `- ${n}`).join("\n")}`);
    }
    parts.push(`# Not in the data\n${context.unavailable.map((u) => `- ${u.label}: ${u.reason}`).join("\n")}`);
  }

  return parts;
}

/** The context and brief as compact text. */
export function conceptsMessage(input: { context: CreativeContext | null; brief: CreativeBrief; aspectRatio: AspectRatio; dataInformed: boolean; exploratoryReason: string | null }): string {
  const { brief } = input;
  const parts = contextParts(input);
  if (!input.dataInformed) parts.push(`# Basis\nExploratory concepts: ${input.exploratoryReason}`);

  const briefLines = (Object.keys(fieldLabels) as (keyof CreativeBrief)[])
    .filter((k) => brief[k]?.trim())
    .map((k) => `- ${fieldLabels[k]}: ${brief[k]!.trim()}`);
  parts.push(`# The user's brief (their own words, not verified)\n${briefLines.length ? briefLines.join("\n") : "- (none given: keep claims generic and list what you assume)"}`);
  parts.push(`# Format\nPreferred aspect ratio: ${input.aspectRatio}. Use it unless a concept clearly needs another supported one.`);

  return parts.join("\n\n");
}

/**
 * Standing instructions for proposing the brief's empty fields. A brief is the
 * team's intent, so suggestions carry no figures, and anything the data can't
 * show (audience demographics, product details, brand rules) is an assumption.
 */
export function buildBriefPrompt(today: string, dataInformed: boolean): string {
  const basis = dataInformed
    ? `You get the selected campaign (or ad set or ad) and its measured performance, computed by the server from the ad warehouse.`
    : `There is no usable performance data (none was selected, or it has too little delivery). Base the suggestions on the selection's names, channel and country if there is one, and otherwise on sensible defaults, all marked as assumptions.`;

  return `You are ADWISE's creative strategist for Livensa's marketing team. The user is filling in a creative brief for a new paid social ad (Meta, TikTok) and asked you to suggest the fields they left empty. Today is ${today}.

${basis}

# Fields
- productContext: what is advertised and the campaign's goal, as far as the names show it (e.g. a campaign name containing "Subs" points to a subscription goal). Never invent product features, prices, offers, trial lengths or discounts; if the data doesn't name them, say what the user should fill in.
- targetAudience: only what the targeting shows (country, channel, ad set names such as "Broad" or "LAL" for lookalike). The data has no age, gender, income or interests: never state any as fact. You may propose an audience to test, marked as an assumption.
- desiredMessage: one direction for the ad's message. When the measured data suggests one (e.g. clicks hold up but trial → subscription fell), propose a message to test that addresses it, without claiming the creative caused the change.
- brandVoice and visualPreferences: style proposals. You may draw on the creative types and ad names in the data, but don't claim they performed well because of their style.
- constraints: practical must / must-not rules: no invented offers or claims, no text or logos in the image (copy is added separately), no real people or trademarks, platform ad policies.

# Rules
- Suggest only the fields listed as empty, at most one suggestion per field. Use what the user already wrote as context and stay consistent with it.
- No money or percentage figures anywhere: describe direction ("fell", "held up"), not numbers. Sentences with figures are deleted.
- \`basis\` is "data" only when the suggestion follows directly from the selection's names or measured performance; otherwise "assumption".
- \`note\` (≤ ${BRIEF_SUGGESTION_LIMITS.note} chars) says briefly what the suggestion rests on, e.g. "From the ad set names (Broad, LAL)." or "Assumption: the data has no audience demographics."
- \`value\` is what goes in the field, written as the user would: plain, concrete, 1–2 sentences, about ${BRIEF_SUGGESTION_LIMITS.target} characters at most.

# Answer format
Reply with one JSON object and nothing else:
{ "suggestions": [{ "field": one of ${BRIEF_FIELDS.map((f) => `"${f}"`).join(", ")}, "value": "…", "basis": "data" | "assumption", "note": "…" }] }`;
}

/** The context, what the user already wrote, and which fields are empty. */
export function briefMessage(input: { context: CreativeContext | null; brief: CreativeBrief; dataInformed: boolean; exploratoryReason: string | null }): string {
  const { brief } = input;
  const parts = contextParts(input);
  if (!input.dataInformed) parts.push(`# Basis\nNo usable performance data: ${input.exploratoryReason}`);
  const filled = BRIEF_FIELDS.filter((k) => brief[k]?.trim());
  const empty = BRIEF_FIELDS.filter((k) => !brief[k]?.trim());
  parts.push(`# Already written by the user (keep consistent; don't suggest these)\n${filled.length ? filled.map((k) => `- ${fieldLabels[k]}: ${brief[k]!.trim()}`).join("\n") : "- (nothing yet)"}`);
  parts.push(`# Empty fields to suggest\n${empty.map((k) => `- ${k} (${fieldLabels[k]})`).join("\n")}`);
  return parts.join("\n\n");
}
