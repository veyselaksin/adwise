import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { LogFilters } from "@components/observability/log-filters";
import { LogList, LogPager } from "@components/observability/log-table";
import { StateCard } from "@components/observability/obs-shared";
import { ObsToolbar } from "@components/observability/obs-toolbar";
import { Overview } from "@components/observability/overview";
import { RunFilters } from "@components/observability/run-filters";
import { RunTable } from "@components/observability/run-table";
import { RuntimePanel } from "@components/observability/runtime-panel";
import { Card } from "@components/ui/card";
import { Skeleton } from "@components/ui/skeleton";
import { LOGS_PAGE_SIZE, OBS_RANGES, RUNS_PAGE_SIZE } from "@constants/observability";
import { ApiError, getLogs, getObservabilitySummary, getObservabilityTimeseries, getRuns, getRuntime } from "@lib/api";
import { type ObsState, parseObsState } from "@lib/observability";

export const metadata: Metadata = { title: "Observability · ADWISE" };

export default function ObservabilityPage({ searchParams }: PageProps<"/observability">) {
  return (
    <AgentProvider>
      <AppHeader active="/observability">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
          <p className="text-sm text-muted-foreground">
            How the agent and the API are running: every agent question and investigation is traced (model calls, tool calls, timings, tokens,
            cost), warnings and errors are kept, and this process reports its own runtime. Never prompts, answers or ad data.
          </p>
        </div>
        <Suspense fallback={<TabSkeleton />}>
          <Sections searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Sections({ searchParams }: Pick<PageProps<"/observability">, "searchParams">) {
  const state = parseObsState(await searchParams);
  return (
    <>
      <ObsToolbar state={state} />
      {/* Keyed by the URL state, so a filter change shows the skeleton instead of stale rows. */}
      <Suspense key={JSON.stringify(state)} fallback={<TabSkeleton />}>
        {state.tab === "overview" && <OverviewTab state={state} />}
        {state.tab === "runs" && <RunsTab state={state} />}
        {state.tab === "logs" && <LogsTab state={state} />}
        {state.tab === "runtime" && <RuntimeTab />}
      </Suspense>
    </>
  );
}

/** Turns an API error into a message; anything else (a bug) still reaches the error page. */
async function attempt<T>(load: () => Promise<T>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await load(), error: null };
  } catch (err) {
    if (err instanceof ApiError) return { data: null, error: err.message };
    throw err;
  }
}

async function OverviewTab({ state }: { state: ObsState }) {
  const [summary, series, runtime] = await Promise.all([
    attempt(() => getObservabilitySummary(state.range, state.kind)),
    attempt(() => getObservabilityTimeseries(state.range, state.kind)),
    attempt(() => getRuntime()),
  ]);
  if (summary.error !== null || series.error !== null) {
    return <StateCard title="Couldn't load the run telemetry" body={summary.error ?? series.error} retry />;
  }
  return <Overview state={state} summary={summary.data} series={series.data} runtime={runtime.data} />;
}

async function RunsTab({ state }: { state: ObsState }) {
  const result = await attempt(() =>
    getRuns({
      range: state.range,
      kind: state.kind,
      status: state.status,
      model: state.model,
      tool: state.tool,
      minDurationMs: state.minMs,
      maxDurationMs: state.maxMs,
      q: state.q,
      sort: state.sort,
      order: state.order,
      limit: RUNS_PAGE_SIZE,
      offset: (state.page - 1) * RUNS_PAGE_SIZE,
    }),
  );
  if (result.error !== null) {
    return <StateCard title="Couldn't load agent runs" body={result.error} retry />;
  }
  const list = result.data;
  const filtered = !!(state.status || state.model || state.tool || state.minMs !== undefined || state.maxMs !== undefined || state.q || state.kind);
  const window = OBS_RANGES.find((r) => r.value === state.range)!.label.toLowerCase();

  return (
    <div className="flex flex-col gap-3">
      <RunFilters state={state} models={list.options.models} tools={list.options.tools} />
      {filtered && list.total > 0 && (
        <p className="text-xs text-muted-foreground">Filtered: showing only matching runs from the {window}.</p>
      )}
      {list.runs.length === 0 ? (
        <StateCard
          title={filtered ? "No runs match these filters" : `No runs in the ${window}`}
          body={
            filtered
              ? "Clear a filter or pick a longer window. A run id search matches the start of a run id or trace id."
              : "A run is recorded for each question to the agent and each campaign investigation. Ask ADWISE something and it appears here."
          }
        />
      ) : (
        <Card className="px-4 py-3">
          <RunTable state={state} list={list} />
        </Card>
      )}
    </div>
  );
}

async function LogsTab({ state }: { state: ObsState }) {
  const result = await attempt(() =>
    getLogs({
      range: state.range,
      level: state.level,
      errorsOnly: state.errorsOnly,
      component: state.component,
      correlationId: state.cid,
      before: state.before,
      limit: LOGS_PAGE_SIZE,
    }),
  );
  if (result.error !== null) {
    return <StateCard title="Couldn't load logs" body={result.error} retry />;
  }
  const page = result.data;
  const filtered = !!(state.level || state.errorsOnly || state.component || state.cid);
  return (
    <div className="flex flex-col gap-3">
      <LogFilters state={state} components={page.components} />
      <p className="text-xs text-muted-foreground">
        Stored: every warning and error from the API, plus application events (finished runs, retention). Ordinary request lines aren&apos;t kept.
        Values are redacted on the server before storing.
      </p>
      {page.entries.length === 0 ? (
        <StateCard
          title={filtered ? "No log lines match these filters" : "No stored log lines in this window"}
          body={filtered ? "Clear a filter or pick a longer window." : "That's normal for a quiet period: only warnings, errors and application events are stored."}
        />
      ) : (
        <>
          <LogList entries={page.entries} />
          <LogPager state={state} nextBefore={page.nextBefore} count={page.entries.length} />
        </>
      )}
    </div>
  );
}

async function RuntimeTab() {
  const result = await attempt(() => getRuntime());
  return <RuntimePanel initial={result.data} />;
}

function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
