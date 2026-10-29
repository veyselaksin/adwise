export const EXPORT_FORMATS = {
  pdf: { label: "PDF report", extension: "pdf", contentType: "application/pdf" },
  xlsx: {
    label: "Excel workbook",
    extension: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  csv: { label: "CSV (ads)", extension: "csv", contentType: "text/csv; charset=utf-8" },
  json: { label: "JSON", extension: "json", contentType: "application/json; charset=utf-8" },
  md: { label: "Markdown", extension: "md", contentType: "text/markdown; charset=utf-8" },
} as const;

/** CSV holds one table: ads when included, since they roll up to every other level. */
export const CSV_DEFAULT_TABLE = "ads";
