import "server-only";
import writeExcelFile, { type Cell, type Row, type SheetData } from "write-excel-file/node";
import type { Unit } from "@/types/metrics.type";
import type { ExportReport, ExportTable } from "@/types/export.type";

const NUMBER_FORMATS: Record<Unit, string> = {
  usd: "[$$-409]#,##0.00",
  count: "#,##0",
  ratio: "0.0%",
};
/** Same amber as the dashboard's "not final" marker. */
const NOT_FINAL_COLOR = "#9A6700";

/** A Summary sheet (filters, notes, key metrics), then one sheet per table with real numbers. */
export async function toXlsx(report: ExportReport): Promise<Uint8Array> {
  const kpis = report.tables.find((t) => t.id === "kpis");
  const rest = report.tables.filter((t) => t !== kpis);
  const summary: SheetData = [
    [{ value: report.title, fontWeight: "bold", fontSize: 14 }],
    [`Generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC`],
    [],
    ...report.filters.map((f): Row => [{ value: f.label, fontWeight: "bold" }, f.value]),
    [],
    ...report.notes.map((n): Row => [n]),
    [],
    ...(kpis ? tableRows(kpis) : []),
  ];

  return writeExcelFile([
    { data: summary, sheet: "Summary", columns: [{ width: 22 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 60 }] },
    ...rest.map((table) => ({
      data: tableRows(table),
      sheet: table.title.slice(0, 31),
      columns: [...table.columns.map((c) => ({ width: c.unit === "text" ? 24 : 14 })), { width: 30 }],
      stickyRowsCount: table.description ? 3 : 1,
    })),
  ]).toBuffer();
}

function tableRows(table: ExportTable): SheetData {
  const labels = new Map(table.columns.map((c) => [c.key, c.label]));
  const header: Row = [...table.columns.map((c) => c.label), "Not final"].map((label) => ({
    value: label,
    fontWeight: "bold",
    backgroundColor: "#EEEEEE",
  }));
  const body = table.rows.map((row): Row => [
    ...table.columns.map((column): Cell => {
      const value = row.cells[column.key] ?? null;
      if (value === null) return null;
      const unit = row.units?.[column.key] ?? column.unit;
      const notFinal = row.notFinal?.includes(column.key);
      const style = notFinal ? { textColor: NOT_FINAL_COLOR, fontStyle: "italic" as const } : {};
      if (typeof value === "number" && unit !== "text") {
        return { value, type: Number, format: NUMBER_FORMATS[unit], ...style };
      }
      return { value: String(value), ...style };
    }),
    (row.notFinal ?? []).map((k) => labels.get(k) ?? k).join(", ") || null,
  ]);
  return [...(table.description ? [[table.description], []] : []), header, ...body];
}
