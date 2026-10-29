import { AlertTriangleIcon, ImagesIcon, Loader2Icon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@components/ui/badge";
import { creativeImageSrc, creativePath, cssRatio } from "@lib/creatives";
import { formatRange } from "@lib/format";
import { formatSavedDate } from "@lib/insights";
import type { CreativeSummary } from "@typings/creatives";

/** Saved creatives as cards; failed and in-progress ones show their state instead of an image. */
export function CreativeGallery({ items, empty }: { items: CreativeSummary[]; empty: ReactNode }) {
  if (items.length === 0) {
    return <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={creativePath(c.id)} className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:bg-muted/40">
            <div className="relative w-full bg-muted" style={{ aspectRatio: cssRatio(c.aspectRatio === "21:9" ? "16:9" : c.aspectRatio) }}>
              {c.status === "succeeded" && c.image ? (
                <Image src={creativeImageSrc(c.id)} alt={c.title} fill unoptimized sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-xs text-muted-foreground">
                  {c.status === "generating" ? (
                    <>
                      <Loader2Icon className="size-5 animate-spin" aria-hidden="true" /> Generating…
                    </>
                  ) : (
                    <>
                      <AlertTriangleIcon className="size-5 text-destructive" aria-hidden="true" />
                      <span className="font-medium text-foreground">Generation failed</span>
                      <span className="line-clamp-2">{c.error?.message}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
              <p className="line-clamp-1 font-medium group-hover:underline">{c.title}</p>
              <p className="line-clamp-1 text-sm text-muted-foreground">{c.headline}</p>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
                <Badge variant="outline">{c.dataInformed ? "Data-informed" : "Exploratory"}</Badge>
                {c.parentId && <Badge variant="outline">Variation</Badge>}
                <span>{formatSavedDate(c.createdAt)}</span>
              </div>
              {c.sourceLabel && c.source && (
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {c.sourceLabel.campaign} · {formatRange(c.source)}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GalleryEmpty({ filtered }: { filtered: boolean }) {
  return filtered ? (
    <p>No creatives match these filters.</p>
  ) : (
    <>
      <ImagesIcon className="mx-auto mb-2 size-6" aria-hidden="true" />
      <p className="font-medium text-foreground">No creatives yet</p>
      <p className="mt-1">Generate an image in the studio and it&apos;s saved here with its copy and the data it came from.</p>
    </>
  );
}
