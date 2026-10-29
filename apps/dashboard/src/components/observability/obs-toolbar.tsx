"use client";

import { CalendarIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonVariants } from "@components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { OBS_RANGES, OBS_TABS, RUN_KIND_LABELS } from "@constants/observability";
import { type ObsState, obsHref } from "@lib/observability";
import { cn } from "@lib/utils";
import type { ObservabilityRange, RunKind } from "@typings/observability";

/**
 * Section tabs, then the window and run-kind filters shared by every tab. Tabs
 * are links, so each section has its own URL and the back button works.
 */
export function ObsToolbar({ state }: { state: ObsState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Changing the window or kind starts paging over and drops a log cursor.
  const update = (patch: Partial<ObsState>) =>
    startTransition(() => router.push(obsHref({ ...state, page: 1, before: undefined, ...patch }), { scroll: false }));
  const showsKind = state.tab !== "runtime" && state.tab !== "logs";

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Observability sections">
        {OBS_TABS.map((t) => (
          <Link
            key={t.value}
            // Each tab keeps the window and kind, not the other tabs' filters.
            href={obsHref({ tab: t.value, range: state.range, kind: state.kind })}
            aria-current={t.value === state.tab ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "-mb-px rounded-b-none border-b-2 border-transparent",
              t.value === state.tab ? "border-foreground text-foreground" : "text-muted-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {state.tab !== "runtime" && (
        <div className="flex flex-wrap items-center gap-2">
          <Select items={OBS_RANGES} value={state.range} onValueChange={(v) => v && update({ range: v as ObservabilityRange })}>
            <SelectTrigger aria-label="Time window" size="sm" className="min-w-40">
              <CalendarIcon className="text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OBS_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showsKind && (
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Run kind"
              value={[state.kind ?? "all"]}
              onValueChange={(v: string[]) => v[0] && update({ kind: v[0] === "all" ? undefined : (v[0] as RunKind) })}
            >
              <ToggleGroupItem value="all">All runs</ToggleGroupItem>
              {(Object.keys(RUN_KIND_LABELS) as RunKind[]).map((k) => (
                <ToggleGroupItem key={k} value={k}>
                  {RUN_KIND_LABELS[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          {pending && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <Loader2Icon className="size-3.5 animate-spin" /> Loading…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
