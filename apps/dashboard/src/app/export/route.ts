import type { NextRequest } from "next/server";
import { loadDashboard } from "@components/dashboard/load-dashboard";
import { ApiError } from "@lib/api";
import { EXPORT_FORMATS } from "@constants/export";
import { isExportFormat, renderExport } from "@lib/export/formats";
import { buildReport } from "@lib/export/report";
import { parseFilters } from "@lib/filters";

/**
 * GET /export?format=pdf|xlsx|csv|json|md plus the overview's own filter params,
 * so the file matches the view it was downloaded from.
 * - `tables=campaigns,adsets,ads` limits the file to those tables (one card's export).
 * - CSV holds one table: `table`, else ads, else the first selected.
 * Table ids: kpis, daily, countries, campaigns, adsets, ads.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const format = params.get("format");
  if (!isExportFormat(format)) {
    return Response.json(
      { success: false, message: `format must be one of ${Object.keys(EXPORT_FORMATS).join(", ")}`, error: { code: "INVALID_FORMAT" } },
      { status: 400 },
    );
  }

  const filters = parseFilters(Object.fromEntries(params));
  try {
    const report = buildReport(await loadDashboard(filters), filters);
    const table = params.get("table") ?? undefined;
    const tables = params.get("tables")?.split(",").filter(Boolean);
    const unknown = [...(tables ?? []), ...(table ? [table] : [])].filter((id) => !report.tables.some((t) => t.id === id));
    if (unknown.length > 0 || (table && tables && !tables.includes(table))) {
      return Response.json(
        { success: false, message: `Unknown or unselected table: ${unknown.join(", ") || table}`, error: { code: "INVALID_TABLE" } },
        { status: 400 },
      );
    }
    const { body, fileName } = await renderExport(format, report, { tables, table });
    return new Response(body as BodyInit, {
      headers: {
        "content-type": EXPORT_FORMATS[format].contentType,
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return Response.json({ success: false, message: err.message, error: { code: err.code } }, { status: 502 });
  }
}
