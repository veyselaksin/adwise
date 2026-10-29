import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { CreativeGallery, GalleryEmpty } from "@components/creatives/creative-gallery";
import { CreativeStudio } from "@components/creatives/creative-studio";
import { buttonVariants } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { DATE_PATTERN } from "@constants/dates";
import { ApiError, getCreatives, getEntities, getStudioConfig } from "@lib/api";
import { addDays } from "@lib/format";

export const metadata: Metadata = { title: "Creative Studio · ADWISE" };

export default function CreativesPage({ searchParams }: PageProps<"/creatives">) {
  return (
    <AgentProvider>
      <AppHeader active="/creatives">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Creative Studio</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              From measured performance to creative concepts you can test. Figures come from the warehouse; concepts, copy and images are
              AI proposals and hypotheses, not predictions. Nothing is paid for until you generate an image.
            </p>
          </div>
          <Link href="/creatives/library" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open library
          </Link>
        </div>
        <Suspense fallback={<StudioSkeleton />}>
          <Studio searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Studio({ searchParams }: Pick<PageProps<"/creatives">, "searchParams">) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  let loaded;
  try {
    loaded = await Promise.all([getEntities(), getStudioConfig(), getCreatives({ limit: 4 })]);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm">
        <p className="font-medium">Couldn&apos;t load the studio</p>
        <p className="mt-1 text-muted-foreground">{err.message}</p>
        <Link href="/creatives" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>
          Try again
        </Link>
      </div>
    );
  }
  const [entities, config, recent] = loaded;
  const campaign = entities.campaigns.find((c) => c.id === one("campaign"));
  const from = one("from");
  const to = one("to");
  // Default: the last 14 days of data, compared with the 14 before.
  const range =
    from && to && DATE_PATTERN.test(from) && DATE_PATTERN.test(to)
      ? { from, to }
      : { from: addDays(config.data.lastDate, -13), to: config.data.lastDate };

  return (
    <>
      <CreativeStudio entities={entities} config={config} initial={{ campaignId: campaign?.id ?? "", ...range }} />
      <section aria-label="Recent creatives" className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Recent creatives</h2>
          {recent.total > recent.items.length && (
            <Link href="/creatives/library" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              All {recent.total}
            </Link>
          )}
        </div>
        <CreativeGallery items={recent.items} empty={<GalleryEmpty filtered={false} />} />
      </section>
    </>
  );
}

function StudioSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the studio">
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
