import { ClockIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Marks a number that will still change, with the reason on hover. */
export function NotFinal({ reason, className, children }: { reason: string; className?: string; children?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1 text-provisional underline decoration-dotted underline-offset-4",
              className,
            )}
          />
        }
      >
        {children ?? (
          <>
            <ClockIcon className="size-3" aria-hidden="true" />
            <span className="text-xs font-medium">Not final</span>
          </>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  );
}
