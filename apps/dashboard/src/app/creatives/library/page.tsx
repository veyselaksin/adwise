import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { CreativeGallery, GalleryEmpty } from "@components/creatives/creative-gallery";
import { LibraryFilters } from "@components/creatives/library-filters";
import { buttonVariants } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { ApiError, getCreatives } from "@lib/api";
import type { CreativeList, CreativeListQuery } from "@typings/creatives";

export const metadata: Metadata = { title: "Creative library · ADWISE" };

export default function LibraryPage({ searchParams }: PageProps<"/creatives/library">) {
  return (
    <AgentProvider>
      <AppHeader active="/creatives">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Creative library</h1>
            <p className="text-sm text-muted-foreground">
              Images you generated, with their copy, concept and the numbers they were made from. Only you can see your creatives.
            </p>
          </div>
          <Link href="/creatives" className={buttonVariants({ size: "sm" })}>
            New creative
          </Link>
        </div>
        <Suspense fallback={<LibrarySkeleton />}>
          <Library searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Library({ searchParams }: Pick<PageProps<"/creatives/library">, "searchParams">) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const status = one("status");
  const basis = one("basis");
  const page = Math.max(1, Math.min(1000, Number.parseInt(one("page") ?? "1", 10) || 1));
  const query: CreativeListQuery = {
    q: one("q")?.trim().slice(0, 200) || undefined,
    status: status === "succeeded" || status === "failed" || status === "generating" ? status : undefined,
    basis: basis === "data" || basis === "exploratory" ? basis : undefined,
    page,
  };

  let list: CreativeList;
  try {
    list = await getCreatives(query);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm">
        <p className="font-medium">Couldn&apos;t load the library</p>
        <p className="mt-1 text-muted-foreground">{err.message}</p>
        <Link href="/creatives/library" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>
          Try again
        </Link>
      </div>
    );
  }
  const pages = Math.max(1, Math.ceil(list.total / list.limit));
  const pageHref = (p: number) => {
    const next = new URLSearchParams(Object.entries({ ...query, page: String(p) }).filter((e): e is [string, string] => !!e[1]));
    return `/creatives/library?${next}`;
  };

  return (
    <>
      <LibraryFilters query={query} />
      <p className="text-xs text-muted-foreground">
        {list.total} creative{list.total === 1 ? "" : "s"}
      </p>
      <CreativeGallery items={list.items} empty={<GalleryEmpty filtered={!!(query.q || query.status || query.basis)} />} />
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Previous
            </Link>
          )}
          <span className="tabular-nums text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Next
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading creatives">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
      ))}
    </div>
  );
}
