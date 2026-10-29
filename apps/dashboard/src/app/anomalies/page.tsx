import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AnomalyFilters } from "@components/anomalies/anomaly-filters";
import { AnomalyMethod } from "@components/anomalies/anomaly-method";
import { AnomalySummary } from "@components/anomalies/anomaly-summary";
import { AnomalyTable } from "@components/anomalies/anomaly-table";
import { HiddenCapped } from "@components/anomalies/hidden-capped";
import { AppHeader } from "@components/app-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Skeleton } from "@components/ui/skeleton";
import { ApiError, getAnomalies, getCatalog } from "@lib/api";
import { anomalyFiltersToSearch, anomalyQuery, anomalyRange, parseAnomalyFilters } from "@lib/anomaly-filters";
import { formatDay } from "@lib/format";
import type { AnomalyReport } from "@typings/anomalies";

export const metadata: Metadata = { title: "Anomalies · ADWISE" };

export default function AnomaliesPage({ searchParams }: PageProps<"/anomalies">) {
  return (
    <AgentProvider>
      <AppHeader active="/anomalies">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <Suspense fallback={<MonitorSkeleton />}>
          <Monitor searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Monitor({ searchParams }: Pick<PageProps<"/anomalies">, "searchParams">) {
  const filters = parseAnomalyFilters(await searchParams);
  const catalog = await getCatalog();
  const bounds = { first: catalog.firstDataDate, last: catalog.lastDataDate };
  const range = anomalyRange(filters, bounds);

  // A bad range or an API hiccup shows here, next to the filters to fix it, not as a broken page.
  let report: AnomalyReport | null = null;
  let error: string | null = null;
  try {
    report = await getAnomalies(anomalyQuery(filters, range));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    error = err.message;
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Anomaly monitor</h1>
        <p className="text-sm text-muted-foreground">
          Campaign days that moved unusually far from the campaign&apos;s own recent history. Fixed rules on the server, no AI;
          each flag is a signal to investigate, not a conclusion. Data through {formatDay(catalog.lastDataDate)}.
        </p>
      </div>
      <AnomalyFilters filters={filters} range={range} bounds={bounds} />
      {error || !report ? (
        <StateCard title="Couldn't check for anomalies" body={error ?? "Something went wrong."} />
      ) : (
        <Results report={report} showCappedHref={`/anomalies${anomalyFiltersToSearch({ ...filters, showCapped: true })}`} />
      )}
    </>
  );
}

function Results({ report, showCappedHref }: { report: AnomalyReport; showCappedHref: string }) {
  const { coverage, anomalies } = report;
  const skipped = Object.values(coverage.skipped).reduce((n, c) => n + c, 0);
  const ran = coverage.checks - skipped;

  return (
    <>
      <AnomalySummary report={report} />
      {report.hiddenCapped && <HiddenCapped hidden={report.hiddenCapped} showHref={showCappedHref} />}
      {ran === 0 ? (
        <StateCard
          title="Not enough data to check these days"
          body={
            report.summary.campaignsChecked === 0
              ? "No campaign has data for these filters."
              : "Every check was skipped: the days are too early for a baseline, too recent to be final, or too small. Pick later days, or a metric that is final sooner."
          }
        />
      ) : anomalies.length === 0 ? (
        <StateCard
          title={report.hiddenCapped?.total ? "Nothing beyond the capped flags" : "No anomalies in this range"}
          body={
            report.hiddenCapped?.total
              ? "Every flag in this range is capped at low (see above). Nothing else moved outside its campaign's normal range."
              : `All ${ran.toLocaleString("en-US")} checks that could run stayed within each campaign's normal range.`
          }
        />
      ) : (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>
              {anomalies.length} flag{anomalies.length === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>Most severe and newest first. Click a column to sort, a row for the numbers and next steps.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto px-4">
            <AnomalyTable anomalies={anomalies} minScore={report.method.minScore} />
          </div>
        </Card>
      )}
      <AnomalyMethod report={report} />
    </>
  );
}

function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function MonitorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading anomalies">
      <Skeleton className="h-12 w-96 max-w-full" />
      <Skeleton className="h-8 w-[40rem] max-w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
