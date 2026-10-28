import { formatCell } from "./formats";
import type { ExportReport, ExportTable } from "./report";

/**
 * The report as GitHub-flavoured Markdown, formatted like the dashboard (USD two
 * decimals, percentages one), for pasting into docs, Slack or a ticket.
 * Not-final cells carry a `*`, as in the PDF.
 */
export function toMarkdown(report: ExportReport): string {
  const lines = [`# ${report.title}`, "", `_Generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC_`, ""];
  for (const f of report.filters) lines.push(`- **${f.label}:** ${escape(f.value)}`);
  if (report.notes.length > 0) lines.push("", ...report.notes.map((n) => `> ${escape(n)}`));
  for (const table of report.tables) lines.push("", ...tableLines(table));
  return `${lines.join("\n")}\n`;
}

function tableLines(table: ExportTable): string[] {
  const out = [`## ${table.title}`, ""];
  if (table.description) out.push(escape(table.description), "");
  if (table.rows.length === 0) return [...out, "_No data for these filters._"];

  const numeric = table.columns.map((c) => c.unit !== "text");
  out.push(
    row(table.columns.map((c) => c.label)),
    row(numeric.map((n) => (n ? "---:" : "---"))),
    ...table.rows.map((r) =>
      row(table.columns.map((c) => formatCell(table, r, c.key) + (r.notFinal?.includes(c.key) ? "*" : ""))),
    ),
  );
  if (table.rows.some((r) => r.notFinal?.length)) {
    out.push("", "\\* Not final: includes days that are still too recent (e.g. CAC for days less than 4 days old).");
  }
  return out;
}

const row = (cells: string[]) => `| ${cells.map(escape).join(" | ")} |`;

/** Keeps a value from breaking the table or turning into formatting. */
const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
