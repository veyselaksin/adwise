import type { EXPORT_FORMATS } from "../constants/export.constant";
import type { Unit } from "./metrics.type";

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export type CellValue = string | number | null;

export type ExportColumn = { key: string; label: string; unit: Unit | "text" };

export type ExportRow = {
  cells: Record<string, CellValue>;
  /** Column keys whose value includes days that aren't final yet. */
  notFinal?: string[];
  /** Per-cell unit, for columns that mix units (the KPI table). */
  units?: Record<string, Unit>;
};

export type ExportTable = {
  id: string;
  title: string;
  description?: string;
  columns: ExportColumn[];
  rows: ExportRow[];
};

export type ExportReport = {
  title: string;
  generatedAt: string;
  filters: { label: string; value: string }[];
  notes: string[];
  tables: ExportTable[];
  /** Slug for file names, e.g. `adwise_2026-10-01_2026-10-14_meta`. */
  fileName: string;
};
