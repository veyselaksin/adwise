import { CheckIcon, CircleIcon, Loader2Icon, MinusIcon } from "lucide-react";
import { Card } from "@components/ui/card";
import { cn } from "@lib/utils";
import type { InvestigationStage } from "@typings/investigation";

const ICONS = {
  pending: CircleIcon,
  running: Loader2Icon,
  done: CheckIcon,
  skipped: MinusIcon,
} as const;

/** The investigation's steps as the server reports them. */
export function StageList({ stages }: { stages: InvestigationStage[] }) {
  return (
    <Card className="px-4 py-3">
      <ol className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Investigation progress">
        {stages.map((s) => {
          const Icon = ICONS[s.status];
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-2",
                s.status === "pending" && "text-muted-foreground",
                s.status === "skipped" && "text-muted-foreground line-through",
              )}
            >
              <Icon
                className={cn("size-3.5 shrink-0", s.status === "running" && "animate-spin", s.status === "done" && "text-delta-good")}
                aria-hidden="true"
              />
              {s.label}
              <span className="sr-only">({s.status})</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
