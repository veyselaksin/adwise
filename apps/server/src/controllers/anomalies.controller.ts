import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { AnomalyQuery } from "../types/anomalies.type.js";

export const anomaliesController = ({ anomalies }: Services) => ({
  list: async (query: AnomalyQuery) => {
    const report = await anomalies.report(query);
    return success(report, `${report.summary.total} anomal${report.summary.total === 1 ? "y" : "ies"} found`);
  },
});
