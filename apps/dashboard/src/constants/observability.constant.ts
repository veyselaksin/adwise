import type { LogLevel, ObservabilityRange, RunKind, RunStatus, RunStatusFilter } from "@typings/observability";

export const OBS_TABS = [
  { value: "overview", label: "Overview" },
  { value: "runs", label: "Agent runs" },
  { value: "logs", label: "Logs & traces" },
  { value: "runtime", label: "Runtime" },
] as const;
export type ObsTab = (typeof OBS_TABS)[number]["value"];

export const OBS_RANGES: { value: ObservabilityRange; label: string }[] = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];
export const OBS_DEFAULT_RANGE: ObservabilityRange = "24h";

export const RUN_KIND_LABELS: Record<RunKind, string> = { agent: "Agent chat", investigation: "Investigation" };

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  success: "Success",
  failure: "Failed",
  cancelled: "Cancelled",
  timeout: "Timed out",
  interrupted: "Interrupted",
};

export const RUN_STATUS_FILTERS: { value: RunStatusFilter | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed (any)" },
  { value: "timeout", label: "Timed out" },
  { value: "cancelled", label: "Cancelled" },
  { value: "interrupted", label: "Interrupted" },
  { value: "running", label: "Running" },
];

export const LOG_LEVEL_FILTERS: { value: LogLevel | "all"; label: string }[] = [
  { value: "all", label: "All levels" },
  { value: "info", label: "Info and above" },
  { value: "warn", label: "Warnings and above" },
  { value: "error", label: "Errors only" },
];

/** Page sizes the dashboard asks for; the API caps them too. */
export const RUNS_PAGE_SIZE = 25;
export const LOGS_PAGE_SIZE = 50;

/** How often the Runtime tab refreshes while it's open. The server samples every 10 s, so faster adds nothing. */
export const RUNTIME_POLL_MS = 15_000;
