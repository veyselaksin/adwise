import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { InsightFilters } from "@components/insights/insight-filters";
import { InsightList } from "@components/insights/insight-list";
import { buttonVariants } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { DATE_PATTERN } from "@constants/dates";
import { ApiError, getInsights } from "@lib/api";
import type { InsightQuery, InsightSummary } from "@typings/insights";

export const metadata: Metadata = { title: "Insights · ADWISE" };

export default function InsightsPage({ searchParams }: PageProps<"/insights">) {
  return (
    <AgentProvider>
      <AppHeader active="/insights">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
          <p className="text-sm text-muted-foreground">
            Agent answers the team saved, each with the data the agent looked up at the time. Reports don&apos;t
            change when opened later; share one with its link.
          </p>
        </div>
        <Suspense fallback={<LibrarySkeleton />}>
          <Library searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Library({ searchParams }: Pick<PageProps<"/insights">, "searchParams">) {
  const query = parseQuery(await searchParams);
  let insights: InsightSummary[];
  try {
    insights = await getInsights(query);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return <LoadError message={err.message} />;
  }
  return (
    <>
      <InsightFilters query={query} />
      <InsightList insights={insights} filtered={!!(query.q || query.from || query.to)} />
    </>
  );
}

function parseQuery(params: Record<string, string | string[] | undefined>): InsightQuery {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const date = (key: string) => {
    const v = one(key);
    return v && DATE_PATTERN.test(v) ? v : undefined;
  };
  const from = date("from");
  const to = date("to");
  const ordered = !(from && to && from > to);
  return {
    q: one("q")?.trim().slice(0, 200) || undefined,
    sort: one("sort") === "oldest" ? "oldest" : "newest",
    ...(ordered ? { from, to } : {}),
  };
}

function LoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm">
      <p className="font-medium">Couldn&apos;t load the insights</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <Link href="/insights" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>
        Try again
      </Link>
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading insights">
      <Skeleton className="h-8" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}
