import { success } from "../lib/response.js";
import type { Services } from "../plugins/services.js";
import type { RunListQuery } from "../services/observability.service.js";
import type { LogQuery } from "../types/observability.type.js";
import type { ObservabilityRange, RunKind } from "../types/telemetry.type.js";

export const observabilityController = ({ observability, runtime }: Services) => ({
  summary: (q: { range: ObservabilityRange; kind?: RunKind }) => success(observability.summary(q.range, q.kind), "Summary loaded"),
  timeseries: (q: { range: ObservabilityRange; kind?: RunKind }) => success(observability.timeseries(q.range, q.kind), "Time series loaded"),
  runs: (q: RunListQuery) => {
    const page = observability.listRuns(q);
    return success(page, `${page.total} run${page.total === 1 ? "" : "s"} found`);
  },
  run: (id: string) => success(observability.run(id), "Run loaded"),
  logs: (q: LogQuery) => success(observability.logs(q), "Logs loaded"),
  runtime: async () => success(await runtime.snapshot(), "Runtime measured"),
});
