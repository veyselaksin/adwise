import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { InsightReport } from "@components/insights/insight-report";
import { buttonVariants } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { ApiError, getCatalog, getInsight } from "@lib/api";
import { indexDefs } from "@lib/metrics";
import type { Insight } from "@typings/insights";

export const metadata: Metadata = { title: "Insight · ADWISE" };

// The API answers these for a missing or malformed id; both read as "not found" here.
const MISSING = new Set(["INSIGHT_NOT_FOUND", "VALIDATION_ERROR"]);

export default function InsightPage({ params }: PageProps<"/insights/[id]">) {
  return (
    <AgentProvider>
      <AppHeader active="/insights">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        <Suspense fallback={<ReportSkeleton />}>
          {params.then(({ id }) => (
            <Report id={id} />
          ))}
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Report({ id }: { id: string }) {
  let insight: Insight;
  try {
    insight = await getInsight(id);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return MISSING.has(err.code) ? <Missing /> : <Failed message={err.message} id={id} />;
  }
  // Labels and units for the evidence tables; the figures themselves come from the snapshot.
  const catalog = await getCatalog();
  return <InsightReport insight={insight} defs={indexDefs(catalog.metrics)} />;
}

function Missing() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border px-6 py-8 text-center">
      <h1 className="text-lg font-semibold">Insight not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        It may have been deleted by the person who saved it, or the link is incomplete.
      </p>
      <Link href="/insights" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}>
        Back to Insights
      </Link>
    </div>
  );
}

function Failed({ message, id }: { message: string; id: string }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-md rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
      <h1 className="text-lg font-semibold">Couldn&apos;t load this insight</h1>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Link href={`/insights/${encodeURIComponent(id)}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}>
        Try again
      </Link>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading insight">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-16" />
      <Skeleton className="h-40" />
      <Skeleton className="h-56" />
    </div>
  );
}
