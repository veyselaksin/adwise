import { formatDelta, formatValue, pct, signedPct, usd, count } from "../lib/format.js";
import type { BreakdownRow, InvestigationFacts, PeriodValues } from "../types/investigation.type.js";
import type { Rule } from "../types/rules.type.js";

/**
 * The interpreter's standing instructions: the team's glossary and notes verbatim,
 * any team rules, and what the answer must look like. The facts go in the user
 * message (`factsMessage`), already formatted the way the team reads them.
 */
export function buildInvestigationPrompt(
  today: string,
  docs: { glossary: string; teamNotes: string },
  rules: Pick<Rule, "text">[] = [],
): string {
  const added = rules.length
    ? `\n\n# Rules the team added later (where one conflicts with the notes above, the rule wins)\n${rules.map((r, i) => `${i + 1}. ${r.text}`).join("\n")}`
    : "";

  return `You are ADWISE's performance investigator for Livensa's marketing team. You get verified facts about one campaign in two periods of equal length, computed by the server from the ad warehouse. Your job is to explain what changed and what the evidence suggests about why. Today is ${today}.

# The team's glossary
${docs.glossary}

# The team's notes (follow every one of them)
${docs.teamNotes}${added}

# Rules for the investigation
- The facts are the only source. Never invent metrics, campaigns, ad sets, ads, releases or events. Never recompute or adjust a number.
- Every money or percentage figure you write must appear in the facts exactly as given there (copy it). Prefer pointing to evidence over repeating figures. Statements with figures that aren't in the facts are deleted.
- Every finding cites one or more evidence ids from the facts (\`metric:…\`, \`driver:…\`, \`adset:…\`, \`ad:…\`, \`release:…\`, \`daily\`). Findings without valid evidence are deleted.
- Rank findings by how much of the change they explain (most important first). Use the CAC drivers and the ad set / ad shares of the change to judge that.
- \`kind: "verified"\` only for what the numbers directly show (e.g. "spend moved to ad set X", "CTR fell"). Anything about *why* that the data can't show is \`kind: "hypothesis"\`.
- Metrics marked provisional aren't final: say so, and per the team notes judge recent CAC by cost per trial instead. Don't call an ad set or ad best or worst below 20 subscriptions in a period (marked "small sample").
- Releases only line up with the ads by date: the ad data has no iOS/Android split. A release before a change does not show it caused the change. Mention a release only if its commits could plausibly move that metric, always as a hypothesis, with when it shipped relative to the change. Never lead with a release.
- If the evidence doesn't explain the change, say so plainly in the summary and in a finding.
- Next steps are suggestions for the team to check or try, not facts. Paused ads and ad sets are not candidates to scale.
- Name ad sets and ads by name (ads with their ad set), never by id, in all text. Ids only go in \`evidence\`.

# Answer format
Reply with one JSON object and nothing else:
{
  "summary": "At most 3 short sentences (under 90 words): the answer first, then the main reason the evidence supports, then the main caveat. Details belong in findings.",
  "findings": [{ "title": "short claim", "explanation": "1–3 sentences", "evidence": ["metric:cac", "driver:ctr"], "kind": "verified" | "hypothesis", "confidence": "high" | "medium" | "low" }],
  "releaseNotes": [{ "release": "release:ios-3.46.0", "relevance": "why it might or might not matter, with timing" }],
  "nextSteps": ["concrete check or action"],
  "limitations": ["what this data can't tell, beyond the limitations already listed in the facts"]
}
At most 6 findings, 5 next steps and 5 limitations. releaseNotes only for releases in the facts; leave it empty when none look relevant.`;
}

const values = (v: PeriodValues) =>
  `spend ${usd(v.spend)}, installs ${count(v.installs)}, trials ${count(v.trials)}, subs ${count(v.subscriptions)}, CAC ${usd(v.cac)}, cost/trial ${usd(v.cost_per_trial)}`;

function breakdownLines(rows: BreakdownRow[]): string {
  return rows
    .map((r) =>
      [
        `- ${r.evidenceId} | ${r.name}${r.adsetName ? ` (ad set ${r.adsetName})` : ""}${r.status ? ` | ${r.status}` : ""}${r.smallSample ? " | small sample" : ""}`,
        `  previous: ${values(r.previous)}`,
        `  current: ${values(r.current)}`,
        `  share of the campaign's spend change ${pct(r.spendShareOfChange)}, of its subscription change ${pct(r.subscriptionShareOfChange)}`,
      ].join("\n"),
    )
    .join("\n");
}

/** The facts as compact text, every figure already formatted, so the model copies instead of rounding. */
export function factsMessage(facts: InvestigationFacts): string {
  const { campaign, current, previous } = facts;
  const metrics = facts.metrics
    .map((m) => {
      const maturity = [m.provisional.previous && "previous not final", m.provisional.current && "current not final"].filter(Boolean).join(", ");
      return `- ${m.evidenceId} | ${m.label}${m.formula ? ` (${m.formula})` : ""}${m.inGlossary ? "" : " [not in the glossary]"} | previous ${formatValue(m.unit, m.previous)} | current ${formatValue(m.unit, m.current)} | change ${formatDelta(m.unit, m.absChange)} (${signedPct(m.pctChange)})${m.assessment ? ` | ${m.assessment}` : ""}${maturity ? ` | ${maturity}` : ""}`;
    })
    .join("\n");

  const drivers = facts.drivers.available
    ? [
        `CAC changed ${signedPct(facts.drivers.cacChange)}. CAC = CPM ÷ 1000 ÷ CTR ÷ click→install ÷ install→sub; each step's effect on CAC with the others held fixed, and its share of the change:`,
        ...facts.drivers.items.map(
          (d) =>
            `- ${d.evidenceId} | ${d.label} | previous ${formatValue(d.unit, d.previous)} | current ${formatValue(d.unit, d.current)} (${signedPct(d.pctChange)}) | effect on CAC ${signedPct(d.effectOnCac)} | share ${pct(d.share)}${d.provisional ? " | not final" : ""}`,
        ),
      ].join("\n")
    : facts.drivers.reason;

  const daily = facts.daily
    .map((d) => `- ${d.date} (${d.period}) | spend ${usd(d.spend)} | trials ${count(d.trials)} | subs ${count(d.subscriptions)} | CAC ${usd(d.cac)} | cost/trial ${usd(d.cost_per_trial)}${d.provisional ? " | CAC not final" : ""}`)
    .join("\n");

  const releases = facts.releases.length
    ? facts.releases
        .map((r) =>
          [
            `- ${r.evidenceId} | ${r.platform} ${r.version} | released ${r.released} UTC | ${r.period} period, day ${r.dayOffset >= 0 ? "+" : ""}${r.dayOffset} from the selected period's start`,
            ...r.commits.map((c) => `  - ${c.type ?? "change"}${c.scope ? `(${c.scope})` : ""}: ${c.title}${c.body ? ` — ${c.body.replace(/\s+/g, " ").slice(0, 200)}` : ""}`),
          ].join("\n"),
        )
        .join("\n")
    : "None in these two periods.";

  return `# Campaign
${campaign.name} (${campaign.channel}, ${campaign.country}), currently ${campaign.status}.
Selected period: ${current.range.from} → ${current.range.to} (${current.days} days). Previous period: ${previous.range.from} → ${previous.range.to}.
Headline metric: ${facts.headlineMetric === "cac" ? "CAC" : "cost per trial (CAC isn't final for the selected period)"}.
Server's overview: ${facts.overview}

# Metrics (evidence id | metric | previous | current | change)
${metrics}

# CAC drivers
${drivers}

# Ad sets, biggest movers (${facts.adsets.rows.length} of ${facts.adsets.total})
${breakdownLines(facts.adsets.rows) || "None."}

# Ads, biggest movers (${facts.ads.rows.length} of ${facts.ads.total})
${breakdownLines(facts.ads.rows) || "None."}

# Daily (evidence id: daily)
${daily}

# App releases in the two periods
${releases}

# Known limitations
${facts.limitations.map((l) => `- ${l}`).join("\n") || "- None."}`;
}
