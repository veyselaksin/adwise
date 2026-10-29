"use client";

import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@lib/utils";

/**
 * The ad's call-to-action as a feed ad shows it. It has nowhere to go (the data
 * holds no landing page), so a click says so instead of doing nothing.
 */
export function CtaPreview({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={noteId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {label}
        <ChevronRightIcon className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <p id={noteId} role="status" className="text-xs text-muted-foreground">
          Preview of the ad&apos;s button. In the live ad it opens your landing page or app store listing, which you set when you publish it in Meta or
          TikTok. ADWISE doesn&apos;t have that link, so it goes nowhere here.
        </p>
      )}
    </div>
  );
}
