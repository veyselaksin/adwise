import { ArrowLeftIcon, DatabaseIcon, ExternalLinkIcon, InfoIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AgentMarkdown } from "@components/agent/agent-markdown";
import { Badge } from "@components/ui/badge";
import { buttonVariants } from "@components/ui/button";
import { formatDay, formatRange } from "@lib/format";
import { campaignHref, channelLabel, countryLabel, formatSavedTime, overviewHref } from "@lib/insights";
import type { Insight } from "@typings/insights";
import type { MetricDefs } from "@typings/metrics";
import { EvidenceView } from "./evidence-view";
import { InsightActions } from "./insight-actions";

/**
 * A saved insight, read-only. Everything here comes from the snapshot taken
 * when the answer was given; nothing is re-run. The data the agent looked up
 * and the model's interpretation are kept in separate, labeled sections.
 */
export function InsightReport({ insight, defs }: { insight: Insight; defs: MetricDefs }) {
  const { snapshot, scope, caveats } = insight;
  const overview = overviewHref(scope);
  const edited = insight.updatedAt !== insight.createdAt;

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/insights" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" /> Insights
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-balance">{insight.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Saved {formatSavedTime(insight.createdAt)} by {insight.owner}
              {edited && " · renamed since"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {overview && (
              <Link href={overview} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLinkIcon /> Open in overview
              </Link>
            )}
            <InsightActions insight={insight} afterDelete="/insights" />
          </div>
        </div>
      </div>

      <section aria-labelledby="question" className="rounded-xl border bg-muted/30 px-4 py-3">
        <h2 id="question" className="text-xs font-medium text-muted-foreground">
          Question
        </h2>
        <p className="mt-1 font-medium">{snapshot.question}</p>
        {snapshot.earlierQuestions.length > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Asked after: {snapshot.earlierQuestions.map((q) => `“${q}”`).join(" · ")}
          </p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <Fact label="Reporting period">
          {scope.period ? <span className="tabular-nums">{formatRange(scope.period)}</span> : "—"}
          {scope.ranges.length > 1 && (
            <span className="block text-xs text-muted-foreground tabular-nums">
              {scope.ranges.map(formatRange).join(" · ")}
            </span>
          )}
        </Fact>
        <Fact label="Channels">{scope.channels.length ? scope.channels.map(channelLabel).join(", ") : "All"}</Fact>
        <Fact label="Countries">{scope.countries.length ? scope.countries.map(countryLabel).join(", ") : "All"}</Fact>
        <Fact label="Data as of">
          <span className="tabular-nums">{formatDay(snapshot.dataToday)}</span>
        </Fact>
        {scope.campaigns.length > 0 && (
          <div className="col-span-full">
            <dt className="text-xs text-muted-foreground">Campaigns</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {scope.campaigns.map((c) => (
                <Link
                  key={c.id}
                  href={campaignHref(c.id, scope)}
                  className={buttonVariants({ variant: "outline", size: "xs" })}
                  title="Investigate this campaign over the same period (live data)"
                >
                  {c.name}
                  <span className="text-muted-foreground">
                    {channelLabel(c.channel)} · {c.country}
                  </span>
                </Link>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="interpretation" className="flex flex-col gap-2">
        <SectionTitle id="interpretation" icon={<SparklesIcon />} badge="AI-generated">
          Answer and interpretation
        </SectionTitle>
        <p className="text-xs text-muted-foreground">
          Written by {snapshot.model.label} from the data below on {formatSavedTime(snapshot.answeredAt)}. Check its
          figures and recommendations against the verified data.
        </p>
        <div className="rounded-xl border px-4 py-3">
          <AgentMarkdown>{snapshot.answer}</AgentMarkdown>
        </div>
        {snapshot.notes.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">The agent&apos;s working notes</summary>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 italic">
              {snapshot.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {caveats.length > 0 && (
        <section aria-labelledby="caveats" className="flex flex-col gap-2">
          <SectionTitle id="caveats" icon={<TriangleAlertIcon />}>
            Limitations in the data
          </SectionTitle>
          <ul className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm">
            {caveats.map((c) => (
              <li key={c.text} className="flex gap-2">
                <span className="text-muted-foreground">•</span> {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="evidence" className="flex flex-col gap-2">
        <SectionTitle id="evidence" icon={<DatabaseIcon />} badge="Verified data">
          Evidence
        </SectionTitle>
        <p className="text-xs text-muted-foreground">
          Every lookup the agent made, with its output exactly as the agent read it from the warehouse, signed by the
          server when the answer was given. Figures are not recalculated.
        </p>
        {snapshot.evidence.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            The agent answered without looking up any data, so there&apos;s no evidence behind this answer.
          </p>
        ) : (
          snapshot.evidence.map((e) => <EvidenceView key={e.id} evidence={e} defs={defs} />)
        )}
      </section>

      {scope.metrics.length > 0 && (
        <section aria-labelledby="definitions" className="flex flex-col gap-2">
          <SectionTitle id="definitions" icon={<InfoIcon />}>
            Definitions
          </SectionTitle>
          <dl className="grid gap-2 rounded-xl border px-4 py-3 text-sm sm:grid-cols-2">
            {scope.metrics.map((m) => (
              <div key={m.key}>
                <dt className="font-medium">{m.label}</dt>
                <dd className="text-xs text-muted-foreground">
                  {m.formula ?? "Summed from the warehouse"}
                  {m.finalAfterDays > 0 && ` · final once an install day is ${m.finalAfterDays} days old`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">From the team&apos;s glossary and notes, as the dashboard and the agent use them.</p>
        </section>
      )}
    </article>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function SectionTitle({ id, icon, badge, children }: { id: string; icon: ReactNode; badge?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      {children}
      {badge && (
        <Badge variant={badge === "Verified data" ? "secondary" : "outline"} className="font-normal">
          {badge}
        </Badge>
      )}
    </h2>
  );
}
