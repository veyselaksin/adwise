import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { InvestigationWorkspace } from "@components/investigation/investigation-workspace";
import { Skeleton } from "@components/ui/skeleton";
import { getCatalog, getEntities } from "@lib/api";
import { DATE_PATTERN } from "@constants/dates";
import { addDays } from "@lib/format";

export const metadata: Metadata = { title: "Investigate · ADWISE" };

export default function InvestigatePage({ searchParams }: PageProps<"/investigate">) {
  return (
    <AgentProvider>
      <AppHeader active="/investigate">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <Suspense fallback={<InvestigateSkeleton />}>
          <Investigate searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Investigate({ searchParams }: Pick<PageProps<"/investigate">, "searchParams">) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const [entities, catalog] = await Promise.all([getEntities(), getCatalog()]);

  const campaign = entities.campaigns.find((c) => c.id === one("campaign"));
  const from = one("from");
  const to = one("to");
  // Default: the last 7 days against the 7 before them.
  const range =
    from && to && DATE_PATTERN.test(from) && DATE_PATTERN.test(to)
      ? { from, to }
      : { from: addDays(catalog.lastDataDate, -6), to: catalog.lastDataDate };
  // `back` is the overview's query string; rebuilt so only search params get through.
  const back = new URLSearchParams(one("back") ?? "").toString();

  return (
    <InvestigationWorkspace
      campaigns={entities.campaigns}
      bounds={{ first: catalog.firstDataDate, last: catalog.lastDataDate }}
      initial={{ campaignId: campaign?.id ?? "", ...range }}
      autorun={one("run") === "1" && !!campaign}
      back={back}
    />
  );
}

function InvestigateSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading investigation">
      <Skeleton className="h-12 w-96 max-w-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
