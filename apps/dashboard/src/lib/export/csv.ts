import type { Unit } from "@/lib/types";
import type { CellValue, ExportTable } from "./report";

/** Money to the cent, ratios to 4 decimals (0.0364 = 3.64%); counts as they are. */
const DECIMALS: Record<Unit, number | null> = { usd: 2, ratio: 4, count: null };

/**
 * RFC 4180 CSV with raw numbers (ratios as 0–1) and a `Not final` column. Starts
 * with a BOM so Excel reads symbols like ÷ and → as UTF-8.
 */
export function toCsv(table: ExportTable): string {
  const labels = new Map(table.columns.map((c) => [c.key, c.label]));
  const header = [...table.columns.map((c) => c.label), "Not final"];
  const lines = table.rows.map((row) => [
    ...table.columns.map((c) => round(row.cells[c.key] ?? null, row.units?.[c.key] ?? c.unit)),
    (row.notFinal ?? []).map((k) => labels.get(k) ?? k).join("; "),
  ]);
  return `\uFEFF${[header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function round(value: CellValue, unit: Unit | "text"): CellValue {
  const decimals = unit === "text" ? null : DECIMALS[unit];
  return typeof value === "number" && decimals !== null ? Number(value.toFixed(decimals)) : value;
}

function csvCell(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  // Neutralise spreadsheet formulas in text (CSV injection); plain "-2.5%" stays as is.
  const formulaLike = /^[=+\-@\t\r]/.test(value) && !/^-[\d.,]+(%| pts)?$/.test(value);
  const text = formulaLike ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
