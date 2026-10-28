/**
 * The dashboard's export formats and report tables (its `/export` route renders
 * the file). The agent's export_report tool only names them; the file itself is
 * built by the dashboard, so it matches the overview.
 */
export const EXPORT_FORMATS = ["pdf", "xlsx", "csv", "json", "md"] as const;

export const EXPORT_FORMAT_LABELS: Record<(typeof EXPORT_FORMATS)[number], string> = {
  pdf: "PDF report",
  xlsx: "Excel workbook",
  csv: "CSV",
  json: "JSON",
  md: "Markdown",
};

export const EXPORT_TABLES = ["kpis", "daily", "countries", "campaigns", "adsets", "ads"] as const;

/** The overview's default period, used when the user names none. */
export const EXPORT_DEFAULT_PRESET = "last_14_days";
