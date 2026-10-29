import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { StateCard } from "@components/observability/obs-shared";
import { TraceView } from "@components/observability/trace-view";
import { buttonVariants } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { ApiError, getRun } from "@lib/api";
import type { RunDetail } from "@typings/observability";

export const metadata: Metadata = { title: "Run trace · ADWISE" };

// The API answers these for an unknown or malformed id; both read as "not found" here.
const MISSING = new Set(["RUN_NOT_FOUND", "VALIDATION_ERROR"]);

export default function RunPage({ params }: PageProps<"/observability/runs/[id]">) {
  return (
    <AgentProvider>
      <AppHeader active="/observability">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        <Suspense fallback={<TraceSkeleton />}>
          {params.then(({ id }) => (
            <Trace id={id} />
          ))}
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Trace({ id }: { id: string }) {
  let detail: RunDetail;
  try {
    detail = await getRun(id);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (MISSING.has(err.code)) {
      return (
        <StateCard
          title="Run not found"
          body="No run has this id or trace id. Runs are kept for the retention period (30 days by default), and a run whose start couldn't be recorded has no trace."
        >
          <Link href="/observability?tab=runs" className={buttonVariants({ variant: "outline", size: "sm" })}>
            All runs
          </Link>
        </StateCard>
      );
    }
    return <StateCard title="Couldn't load this run" body={err.message} retry />;
  }
  return <TraceView detail={detail} />;
}

function TraceSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-16 w-full max-w-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
