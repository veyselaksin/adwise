import { MAX_QUESTION_CHARS } from "@constants/agent";
import type { Anomaly } from "@typings/anomalies";
import { formatDay } from "./format";

/**
 * The question "Ask ADWISE" sends about one anomaly: the monitor's measured
 * figures, verbatim, and what to do with them. The agent can re-fetch the same
 * record with get_anomalies, so it checks the numbers instead of taking them on trust.
 */
export function anomalyQuestion(a: Anomaly): string {
  const channel = a.campaign.channel === "tiktok" ? "TikTok" : "Meta";
  const text = [
    `Investigate this flag from the Anomaly monitor: ${a.typeLabel} for ${a.campaign.name} (${channel} ${a.campaign.country}) on ${formatDay(a.date)}, id ${a.id}, severity ${a.severity}.`,
    `Measured: ${a.explanation} Volume: ${a.volume}. ${a.metricLabel} = ${a.definition}.${a.caveat ? ` Caveat: ${a.caveat}` : ""}`,
    "Please (1) summarize what changed, quoting the monitor's figures (get_anomalies has this record); (2) show which metrics drove the signal, from query_metrics for this campaign by date and by ad set around that day; (3) list hypotheses the evidence supports, labeled as hypotheses, with releases only as date matches; (4) recommend the next checks for the team.",
    "Keep measured facts, hypotheses and next checks in separate sections. Don't invent figures or redefine metrics; say what the data can't show.",
  ].join("\n\n");
  return text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS - 1)}…` : text;
}
