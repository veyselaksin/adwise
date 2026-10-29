import { AlertTriangleIcon, BotIcon, CpuIcon, LayersIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@components/agent/copy-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { RUN_KIND_LABELS } from "@constants/observability";
import { formatCost, formatDuration, formatTimestamp, formatTokens, NOT_REPORTED, UNAVAILABLE } from "@lib/observability";
import { cn } from "@lib/utils";
import type { AgentSpan, RunDetail } from "@typings/observability";
import { LogList } from "./log-table";
import { RunStatusBadge, SpanStatusBadge, Stat } from "./obs-shared";

const KIND_ICON = { run: LayersIcon, model: BotIcon, tool: WrenchIcon, stage: CpuIcon } as const;
const KIND_LABEL = { run: "Run", model: "Model call", tool: "Tool", stage: "Stage" } as const;
const BAR_COLOR = { model: "var(--series-1)", tool: "var(--series-3)", stage: "var(--muted-foreground)", run: "var(--border)" } as const;

/**
 * One run as it happened: ids, outcome, timing split, then a waterfall of the
 * spans that were actually recorded (nothing is filled in), then its logs.
 * Only observable events are shown: no prompts, answers, reasoning or query results.
 */
export function TraceView({ detail }: { detail: RunDetail }) {
  const { run, spans, logs, partial } = detail;
  const startMs = Date.parse(run.startedAt);
  const lastEnd = Math.max(startMs, ...spans.map((s) => Date.parse(s.startedAt) + s.durationMs));
  // A running or interrupted run has no duration yet: scale to the last recorded span.
  const totalMs = run.durationMs ?? lastEnd - startMs;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{RUN_KIND_LABELS[run.kind]} run</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <IdRow label="Run id" value={run.runId} />
          <IdRow label="Trace id" value={run.traceId} />
          {run.requestId && <IdRow label="Request id" value={run.requestId} logsHref={`/observability?tab=logs&range=30d&cid=${encodeURIComponent(run.requestId)}`} />}
          <dt className="text-muted-foreground">Started</dt>
          <dd className="tabular-nums">
            {formatTimestamp(run.startedAt)}
            {run.completedAt && <span className="text-muted-foreground"> → {formatTimestamp(run.completedAt)}</span>}
          </dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="font-mono text-xs">
            {run.provider} · {run.model}
          </dd>
        </dl>
      </div>

      {partial.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-provisional/50 px-3 py-2 text-sm text-provisional" role="note">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Partial trace</p>
            <ul className="list-disc pl-4">
              {partial.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {(run.errorCategory || run.errorMessage) && (
        <Card className="gap-2 border-delta-bad/40">
          <CardHeader>
            <CardTitle className="text-delta-bad">{run.errorCategory ?? "Error"}</CardTitle>
            <CardDescription>What the run recorded when it ended. Messages are redacted before they&apos;re stored.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm break-words whitespace-pre-wrap">{run.errorMessage ?? "No message recorded."}</p>
          </CardContent>
        </Card>
      )}

      <section aria-label="Run totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Duration (end to end)" value={formatDuration(run.durationMs, run.status === "running" ? "Running" : UNAVAILABLE)} muted={run.durationMs === null} hint="From request to the last streamed event" />
        <Stat
          label="In model calls"
          value={formatDuration(run.modelDurationMs, "None")}
          muted={run.modelDurationMs === null}
          hint={`${run.modelCallCount} call${run.modelCallCount === 1 ? "" : "s"}${run.retryCount ? ` · ${run.retryCount} retr${run.retryCount === 1 ? "y" : "ies"}` : ""}${run.durationMs && run.modelDurationMs ? ` · ${Math.round((run.modelDurationMs / run.durationMs) * 100)}% of the run` : ""}`}
        />
        <Stat
          label="Tokens in / out"
          value={run.inputTokens === null ? NOT_REPORTED : `${formatTokens(run.inputTokens)} / ${formatTokens(run.outputTokens)}`}
          muted={run.inputTokens === null}
          hint={`Provider-reported, ${run.usageReportedCalls} of ${run.modelCallCount} calls${run.usageReportedCalls < run.modelCallCount ? " (partial)" : ""}`}
        />
        <Stat
          label="Cost (est.)"
          value={formatCost(run.estimatedCost, "Cost unavailable")}
          muted={run.estimatedCost === null}
          hint={run.costSource === "provider" ? "USD, as reported by ZenMux" : run.costSource ? "USD, partly estimated from configured prices" : "Not every call has a reported or priced usage"}
        />
      </section>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>
            Each bar is a recorded span, placed by its start time on the run&apos;s scale. Model calls and stages run one after another; tool calls in the same step run
            in parallel. Gaps are the server between steps.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <WaterfallRow
            icon="run"
            name={`${RUN_KIND_LABELS[run.kind]} run`}
            detail={run.rootSpanId}
            offsetPct={0}
            widthPct={100}
            durationMs={run.durationMs}
            status={<RunStatusBadge status={run.status} />}
          />
          {spans.length === 0 ? (
            <p className="py-3 pl-6 text-sm text-muted-foreground">No spans were recorded for this run.</p>
          ) : (
            spans.map((s) => (
              <SpanRow key={s.spanId} span={s} offsetMs={Date.parse(s.startedAt) - startMs} totalMs={totalMs} />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Logs for this run</CardTitle>
          <CardDescription>Persisted lines that carry this run&apos;s id or trace id, newest first.</CardDescription>
        </CardHeader>
        <CardContent>{logs.length === 0 ? <p className="text-sm text-muted-foreground">No log lines name this run.</p> : <LogList entries={logs} linkRuns={false} />}</CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        <Link href="/observability?tab=runs" className="underline-offset-4 hover:underline">
          ← All runs
        </Link>
      </p>
    </div>
  );
}

function IdRow({ label, value, logsHref }: { label: string; value: string; logsHref?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-xs">{value}</span>
        <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} iconOnly />
        {logsHref && (
          <Link href={logsHref} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            logs →
          </Link>
        )}
      </dd>
    </>
  );
}

function SpanRow({ span, offsetMs, totalMs }: { span: AgentSpan; offsetMs: number; totalMs: number }) {
  const offsetPct = totalMs > 0 ? (offsetMs / totalMs) * 100 : 0;
  const widthPct = totalMs > 0 ? (span.durationMs / totalMs) * 100 : 0;
  const detail = span.kind === "model" ? span.model : span.kind === "tool" ? String(span.metadata.label ?? span.tool ?? "") : null;
  const metadata = Object.entries(span.metadata).filter(([k]) => k !== "label");
  return (
    <details className="group rounded-md open:bg-muted/40">
      <summary className="cursor-pointer list-none rounded-md hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <WaterfallRow
          icon={span.kind}
          name={span.name}
          detail={detail}
          offsetPct={offsetPct}
          widthPct={widthPct}
          durationMs={span.durationMs}
          status={<SpanStatusBadge status={span.status} />}
          error={span.status === "error"}
          indent
        />
      </summary>
      <dl className="grid gap-x-6 gap-y-1 px-8 pt-1 pb-3 text-xs sm:grid-cols-[auto_1fr]">
        <Field label="Kind">{KIND_LABEL[span.kind]}</Field>
        <Field label="Started">
          {formatTimestamp(span.startedAt)} · {formatDuration(Math.max(0, offsetMs))} into the run
        </Field>
        <Field label="Span id">
          <span className="font-mono">{span.spanId}</span> · parent <span className="font-mono">{span.parentSpanId}</span>
        </Field>
        {span.kind === "model" && (
          <>
            <Field label="Tokens">
              {span.inputTokens === null
                ? NOT_REPORTED
                : `${formatTokens(span.inputTokens)} in (${formatTokens(span.cachedInputTokens, "?")} cached) · ${formatTokens(span.outputTokens)} out (${formatTokens(span.reasoningTokens, "?")} reasoning)`}
            </Field>
            <Field label="Cost">
              {span.cost === null ? "Unavailable" : `${formatCost(span.cost)} ${span.costSource === "provider" ? "reported by ZenMux" : "estimated from configured prices"}`}
            </Field>
            <Field label="Attempts">{span.attempts === null ? NOT_REPORTED : `${span.attempts}${span.attempts > 1 ? ` (${span.attempts - 1} retried)` : ""}`}</Field>
            {span.providerRequestId && (
              <Field label="Provider request">
                <span className="font-mono">{span.providerRequestId}</span>
              </Field>
            )}
          </>
        )}
        {span.errorCategory && (
          <Field label="Error">
            <span className="font-mono text-delta-bad">{span.errorCategory}</span>
            {span.errorMessage && <span className="block break-words">{span.errorMessage}</span>}
          </Field>
        )}
        {metadata.length > 0 && (
          <Field label="Metadata">
            <span className="font-mono">{metadata.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" · ")}</span>
          </Field>
        )}
      </dl>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function WaterfallRow(props: {
  icon: keyof typeof KIND_ICON;
  name: string;
  detail: string | null;
  offsetPct: number;
  widthPct: number;
  durationMs: number | null;
  status: React.ReactNode;
  error?: boolean;
  indent?: boolean;
}) {
  const Icon = KIND_ICON[props.icon];
  const left = Math.min(99.5, Math.max(0, props.offsetPct));
  const width = Math.max(0.5, Math.min(100 - left, props.widthPct));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_5.5rem_4.5rem]">
      <div className={cn("flex min-w-0 items-center gap-2", props.indent && "pl-4")}>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{props.name}</span>
        {props.detail && <span className="truncate font-mono text-xs text-muted-foreground" title={props.detail}>{props.detail}</span>}
      </div>
      <div className="relative h-3 rounded-sm bg-muted" aria-hidden>
        <div
          className="absolute inset-y-0 rounded-sm"
          style={{ left: `${left}%`, width: `${width}%`, background: props.error ? "var(--delta-bad)" : BAR_COLOR[props.icon] }}
        />
      </div>
      <span className="text-right tabular-nums md:text-right">{formatDuration(props.durationMs, "—")}</span>
      <span className="md:text-right">{props.status}</span>
    </div>
  );
}
