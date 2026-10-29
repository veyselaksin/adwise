import "server-only";
import { CSV_DEFAULT_TABLE, EXPORT_FORMATS } from "@/constants/export.constant";
import { formatMetric } from "@/lib/format";
import type { CellValue, ExportFormat, ExportReport, ExportRow, ExportTable } from "@/types/export.type";
import type { Unit } from "@/types/metrics.type";
import { toCsv } from "./csv";
import { toMarkdown } from "./markdown";
import { toPdf } from "./pdf";
import { toXlsx } from "./xlsx";

export const isExportFormat = (value: string | null): value is ExportFormat => !!value && value in EXPORT_FORMATS;

/**
 * Renders the report, or only `tables` of it (e.g. a single card's export).
 * CSV takes `table`, else ads when present, else the first selected table.
 */
export async function renderExport(
  format: ExportFormat,
  full: ExportReport,
  options: { tables?: string[]; table?: string } = {},
): Promise<{ body: Uint8Array | string; fileName: string }> {
  const scoped = options.tables?.length ? full.tables.filter((t) => options.tables!.includes(t.id)) : full.tables;
  const report = { ...full, tables: scoped };
  const suffix = options.tables?.length ? `_${scoped.map((t) => t.id).join("-")}` : "";
  const fileName = (s = suffix) => `${report.fileName}${s}.${EXPORT_FORMATS[format].extension}`;
  switch (format) {
    case "json":
      return { body: JSON.stringify(toJson(report), null, 2), fileName: fileName() };
    case "csv": {
      const id = options.table ?? (scoped.some((t) => t.id === CSV_DEFAULT_TABLE) ? CSV_DEFAULT_TABLE : scoped[0]?.id);
      const table = report.tables.find((t) => t.id === id);
      if (!table) throw new Error(`Unknown table: ${id}`);
      return { body: toCsv(table), fileName: fileName(`_${table.id}`) };
    }
    case "md":
      return { body: toMarkdown(report), fileName: fileName() };
    case "xlsx":
      return { body: await toXlsx(report), fileName: fileName() };
    case "pdf":
      return { body: await toPdf(report), fileName: fileName() };
  }
}

/** Machine-readable: raw numbers (ratios as 0–1) and a `not_final` list per row. */
function toJson(report: ExportReport) {
  const { title, generatedAt, filters, notes, tables } = report;
  return {
    title,
    generatedAt,
    filters,
    notes,
    tables: Object.fromEntries(
      tables.map((t) => [
        t.id,
        {
          title: t.title,
          ...(t.description && { description: t.description }),
          rows: t.rows.map((r) => ({ ...r.cells, not_final: r.notFinal ?? [] })),
        },
      ]),
    ),
  };
}

/** A cell as text, with the dashboard's formatting (USD two decimals, percentages one). */
export function formatCell(table: ExportTable, row: ExportRow, key: string): string {
  const value: CellValue = row.cells[key] ?? null;
  const unit = row.units?.[key] ?? table.columns.find((c) => c.key === key)?.unit ?? "text";
  if (value === null) return "—";
  if (unit === "text" || typeof value === "string") return String(value);
  return formatMetric({ unit: unit as Unit }, value);
}
