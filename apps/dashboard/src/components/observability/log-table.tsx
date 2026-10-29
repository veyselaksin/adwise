import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@components/ui/badge";
import { buttonVariants } from "@components/ui/button";
import { type ObsState, formatDuration, formatTimestamp, obsHref, shortId } from "@lib/observability";
import { cn } from "@lib/utils";
import type { LogEntry, LogLevel } from "@typings/observability";

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-muted-foreground",
  warn: "border-provisional/50 text-provisional",
  error: "border-delta-bad/40 text-delta-bad",
  fatal: "border-delta-bad bg-delta-bad/10 text-delta-bad",
};

export function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge variant="outline" className={cn("w-12 justify-center uppercase", LEVEL_CLASS[level])}>
      {level}
    </Badge>
  );
}

/**
 * Log lines, newest first. A line that names a run links to its trace; one
 * without a correlation id just shows, with no link. Context is the redacted
 * remainder of the log call, collapsed by default.
 */
export function LogList({ entries, linkRuns = true }: { entries: LogEntry[]; linkRuns?: boolean }) {
  return (
    <ul className="divide-y rounded-xl border" aria-label="Log lines">
      {entries.map((e) => {
        const context = Object.keys(e.context).length > 0 ? JSON.stringify(e.context, null, 2) : null;
        return (
          <li key={e.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatTimestamp(e.timestamp)}</span>
              <LevelBadge level={e.level} />
              {e.component && <span className="font-mono text-xs text-muted-foreground">{e.component}</span>}
              <span className={cn("min-w-0 flex-1 break-words", (e.level === "error" || e.level === "fatal") && "font-medium")}>{e.message}</span>
              {e.errorCategory && <span className="font-mono text-xs text-delta-bad">{e.errorCategory}</span>}
              {e.durationMs !== null && <span className="text-xs tabular-nums text-muted-foreground">{formatDuration(e.durationMs)}</span>}
            </div>
            {(e.runId || e.traceId || e.requestId || context) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {e.runId &&
                  (linkRuns ? (
                    <Link href={`/observability/runs/${e.runId}`} className="font-mono underline-offset-4 hover:underline">
                      run {shortId(e.runId)} →
                    </Link>
                  ) : (
                    <span className="font-mono">run {shortId(e.runId)}</span>
                  ))}
                {e.traceId && !e.runId && linkRuns && (
                  <Link href={`/observability/runs/${e.traceId}`} className="font-mono underline-offset-4 hover:underline">
                    trace {shortId(e.traceId)} →
                  </Link>
                )}
                {e.requestId && <span className="font-mono">request {e.requestId}</span>}
                {context && (
                  <details className="w-full">
                    <summary className="cursor-pointer select-none">Context</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{context}</pre>
                  </details>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Keyset paging: newest page, then "older" from the last line's id. */
export function LogPager({ state, nextBefore, count }: { state: ObsState; nextBefore: number | null; count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {count} line{count === 1 ? "" : "s"} {state.before ? "(older page)" : "(newest first)"}
      </span>
      <div className="flex gap-2">
        {state.before && (
          <Link href={obsHref({ ...state, before: undefined })} className={buttonVariants({ variant: "outline", size: "sm" })} scroll={false}>
            Newest
          </Link>
        )}
        {nextBefore && (
          <Link href={obsHref({ ...state, before: nextBefore })} className={buttonVariants({ variant: "outline", size: "sm" })} scroll={false}>
            Older <ChevronRightIcon />
          </Link>
        )}
      </div>
    </div>
  );
}
