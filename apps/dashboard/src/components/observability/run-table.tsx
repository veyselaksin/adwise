import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@components/agent/copy-button";
import { buttonVariants } from "@components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@components/ui/table";
import { RUN_KIND_LABELS } from "@constants/observability";
import { type ObsState, formatCost, formatDuration, formatTimestamp, formatTokens, NOT_REPORTED, obsHref, shortId } from "@lib/observability";
import { cn } from "@lib/utils";
import type { AgentRun, RunList } from "@typings/observability";
import { RunStatusBadge } from "./obs-shared";

/** One page of runs. Headers sort, rows open the run's trace. */
export function RunTable({ state, list }: { state: ObsState; list: RunList }) {
  const { runs, total, limit, offset } = list;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead state={state} by="startedAt">Started</SortHead>
              <TableHead>Run</TableHead>
              <SortHead state={state} by="status">Status</SortHead>
              <SortHead state={state} by="durationMs" className="text-right">
                Duration
              </SortHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Tokens in / out</TableHead>
              <TableHead className="text-right">Cost (est.)</TableHead>
              <TableHead className="text-right">Tools</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <RunRow key={run.runId} run={run} />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {offset + 1}–{offset + runs.length} of {total.toLocaleString("en-US")} run{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-1">
          <PageLink href={page > 1 ? obsHref({ ...state, page: page - 1 }) : null} label="Previous page">
            <ChevronLeftIcon />
          </PageLink>
          <span className="px-2 tabular-nums">
            Page {page} of {pages}
          </span>
          <PageLink href={page < pages ? obsHref({ ...state, page: page + 1 }) : null} label="Next page">
            <ChevronRightIcon />
          </PageLink>
        </div>
      </div>
    </div>
  );
}

/** A header that sorts by its column; a second click flips the direction. */
function SortHead({ state, by, children, className }: { state: ObsState; by: NonNullable<ObsState["sort"]>; children: string; className?: string }) {
  const sort = state.sort ?? "startedAt";
  const order = state.order ?? "desc";
  const active = sort === by;
  const next = active && order === "desc" ? "asc" : "desc";
  const Icon = order === "desc" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <TableHead className={className} aria-sort={active ? (order === "desc" ? "descending" : "ascending") : "none"}>
      <Link href={obsHref({ ...state, sort: by, order: next, page: 1 })} className="inline-flex items-center gap-1 hover:text-foreground" scroll={false}>
        {children}
        {active && <Icon className="size-3" aria-hidden />}
      </Link>
    </TableHead>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const href = `/observability/runs/${run.runId}`;
  const partialUsage = run.usageReportedCalls > 0 && run.usageReportedCalls < run.modelCallCount;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap tabular-nums">
        <Link href={href} className="hover:underline">
          {formatTimestamp(run.startedAt)}
        </Link>
        <div className="text-xs text-muted-foreground">{RUN_KIND_LABELS[run.kind]}</div>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-0.5">
          <Link href={href} className="font-mono text-xs hover:underline" title={run.runId}>
            {shortId(run.runId)}
          </Link>
          <CopyButton text={run.runId} label="Copy run id" iconOnly />
        </span>
      </TableCell>
      <TableCell>
        <RunStatusBadge status={run.status} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatDuration(run.durationMs, run.status === "running" ? "Running" : "—")}</TableCell>
      <TableCell className="max-w-48 truncate font-mono text-xs" title={`${run.provider} · ${run.model}`}>
        {run.model}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", run.inputTokens === null && "text-muted-foreground")}>
        {run.inputTokens === null ? NOT_REPORTED : `${formatTokens(run.inputTokens)} / ${formatTokens(run.outputTokens)}`}
        {partialUsage && <div className="text-xs text-provisional">partial</div>}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", run.estimatedCost === null && "text-muted-foreground")}>
        {formatCost(run.estimatedCost, "—")}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {run.toolCallCount}
        {run.toolErrorCount > 0 && <span className="text-xs text-delta-bad"> ({run.toolErrorCount} failed)</span>}
      </TableCell>
      <TableCell className="font-mono text-xs text-delta-bad">{run.errorCategory ?? ""}</TableCell>
    </TableRow>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className = buttonVariants({ variant: "outline", size: "icon-sm" });
  return href ? (
    <Link href={href} aria-label={label} className={className} scroll={false}>
      {children}
    </Link>
  ) : (
    <span aria-disabled className={cn(className, "pointer-events-none opacity-50")}>
      {children}
    </span>
  );
}
