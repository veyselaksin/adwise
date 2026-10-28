import "server-only";
import { formatMetric } from "@/lib/format";
import type { Unit } from "@/lib/types";
import { toCsv } from "./csv";
import { toPdf } from "./pdf";
import type { CellValue, ExportReport, ExportRow, ExportTable } from "./report";
import { toXlsx } from "./xlsx";

export const EXPORT_FORMATS = {
  pdf: { label: "PDF report", extension: "pdf", contentType: "application/pdf" },
  xlsx: {
    label: "Excel workbook",
    extension: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  csv: { label: "CSV (ads)", extension: "csv", contentType: "text/csv; charset=utf-8" },
  json: { label: "JSON", extension: "json", contentType: "application/json; charset=utf-8" },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export const isExportFormat = (value: string | null): value is ExportFormat => !!value && value in EXPORT_FORMATS;

/** CSV holds one table: ads when included, since they roll up to every other level. */
export const CSV_DEFAULT_TABLE = "ads";

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
