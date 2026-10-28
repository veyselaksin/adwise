import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { MetricsRequest } from "../types/metrics.type.js";

export const metricsController = ({ metrics }: Services) => ({
  catalog: () => success(metrics.catalog(), "Catalog loaded"),
  query: async (body: MetricsRequest) => success(await metrics.run(body), "Metrics loaded"),
});
