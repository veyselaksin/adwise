import { ArrowLeftIcon, BarChart3Icon, FlaskConicalIcon, LightbulbIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { AgentProvider } from "@components/agent/agent-provider";
import { AgentToggle } from "@components/agent/agent-toggle";
import { AppHeader } from "@components/app-header";
import { CreativeActions } from "@components/creatives/creative-actions";
import { CreativePreview } from "@components/creatives/creative-preview";
import { VariationPanel } from "@components/creatives/variation-panel";
import { NotFinal } from "@components/dashboard/not-final";
import { Badge } from "@components/ui/badge";
import { buttonVariants } from "@components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Skeleton } from "@components/ui/skeleton";
import { ApiError, getCreative, getStudioConfig } from "@lib/api";
import { channelName, creativePath, formatBytes, formatSeconds, formatTimestamp } from "@lib/creatives";
import { formatMetric, formatRange, formatUsd } from "@lib/format";
import { cn } from "@lib/utils";
import type { Creative, StudioConfig } from "@typings/creatives";

export const metadata: Metadata = { title: "Creative · ADWISE" };

// The API answers these for a missing, foreign or malformed id; all read as "not found" here.
const MISSING = new Set(["CREATIVE_NOT_FOUND", "VALIDATION_ERROR"]);

export default function CreativePage({ params }: PageProps<"/creatives/[id]">) {
  return (
    <AgentProvider>
      <AppHeader active="/creatives">
        <AgentToggle />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <Link href="/creatives/library" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 w-fit text-muted-foreground")}>
          <ArrowLeftIcon /> Creative library
        </Link>
        <Suspense fallback={<DetailSkeleton />}>
          {params.then(({ id }) => (
            <Detail id={id} />
          ))}
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Detail({ id }: { id: string }) {
  let creative: Creative;
  let config: StudioConfig;
  try {
    [creative, config] = await Promise.all([getCreative(id), getStudioConfig()]);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return MISSING.has(err.code) ? (
      <Notice title="Creative not found" body="It may have been deleted, or it belongs to another account." />
    ) : (
      <Notice title="Couldn't load the creative" body={err.message} retry={creativePath(id)} />
    );
  }
  const { concept } = creative;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={creative.status === "failed" ? "destructive" : "secondary"}>
            {creative.status === "succeeded" ? "Generated" : creative.status === "failed" ? "Failed" : "Generating"}
          </Badge>
          <Badge variant="outline">{creative.dataInformed ? "Performance-informed" : "Exploratory"}</Badge>
          {creative.parentId && (
            <Link href={creativePath(creative.parentId)}>
              <Badge variant="outline">Variation of an earlier creative</Badge>
            </Link>
          )}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{creative.title}</h1>
        <div className="flex flex-wrap gap-2">
          <CreativeActions creative={creative} />
          <VariationPanel creative={creative} config={config} />
        </div>
      </div>

      {creative.error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium">The image wasn&apos;t generated ({creative.error.code})</p>
          <p className="text-muted-foreground">{creative.error.message} Use “New variation” to try again; it&apos;s a new paid request.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CreativePreview
          id={creative.id}
          hasImage={!!creative.image}
          aspectRatio={creative.aspectRatio}
          copy={creative.copy}
          alt={concept.visualDescription || creative.title}
          className="self-start"
        />

        <div className="flex flex-col gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Concept</CardTitle>
              <CardDescription>The AI&apos;s proposal. Evidence lines are measured; the rest isn&apos;t.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="leading-relaxed">{concept.creativeRationale}</p>
              <Section icon={<BarChart3Icon className="size-3.5" />} title="Measured evidence">
                {concept.performanceEvidence.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None{creative.dataInformed ? " cited" : ": exploratory concept"}.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs">
                    {concept.performanceEvidence.map((e) => (
                      <li key={e.evidenceId + e.observation}>
                        <span className="font-medium">{e.label}:</span> {e.observation}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              {concept.assumptions.length > 0 && (
                <Section icon={<LightbulbIcon className="size-3.5" />} title="Assumptions (not in the data)">
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                    {concept.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </Section>
              )}
              <Section icon={<FlaskConicalIcon className="size-3.5" />} title="Test hypothesis · untested">
                <p className="text-xs">{concept.testHypothesis}</p>
              </Section>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <Field label="Audience" value={concept.targetAudience} />
                <Field label="Core message" value={concept.coreMessage} />
                <Field label="Composition" value={concept.composition} />
                <Field label="Image prompt" value={creative.imagePrompt} />
              </dl>
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Generation</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Field label="Created" value={formatTimestamp(creative.createdAt)} />
                <Field label="Model" value={`${creative.modelLabel} (${creative.model}) via ${creative.provider}`} />
                <Field label="Aspect ratio" value={creative.aspectRatio} />
                <Field
                  label="Image"
                  value={creative.image ? `${creative.image.width ?? "?"}×${creative.image.height ?? "?"} · ${creative.image.mimeType.replace("image/", "").toUpperCase()} · ${formatBytes(creative.image.bytes)}` : "None"}
                />
                <Field label="Duration" value={creative.durationMs === null ? "—" : formatSeconds(creative.durationMs)} />
                <div>
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd>{creative.cost.status === "reported" ? `${formatUsd(creative.cost.usd)} (reported by the provider)` : <span title={creative.cost.reason}>Unavailable</span>}</dd>
                </div>
                {creative.runId && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Trace</dt>
                    <dd>
                      <Link href={`/observability/runs/${creative.runId}`} className="underline-offset-2 hover:underline">
                        Open in Observability
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
              {creative.cost.status === "unavailable" && <p className="mt-2 text-xs text-muted-foreground">{creative.cost.reason}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Source data</CardTitle>
          <CardDescription>
            {creative.sourceLabel && creative.source
              ? `${[creative.sourceLabel.campaign, creative.sourceLabel.adset, creative.sourceLabel.ad].filter(Boolean).join(" › ")} · ${channelName(creative.sourceLabel.channel)} · ${creative.sourceLabel.country} · ${formatRange(creative.source)}. Frozen when the image was generated.`
              : "None: this creative came from a brief alone."}
          </CardDescription>
        </CardHeader>
        {creative.metricsSnapshot && (
          <CardContent>
            {!creative.dataInformed && (
              <p className="mb-2 text-xs text-muted-foreground">This selection had too little delivery to inform the concept; the numbers are kept for reference.</p>
            )}
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {creative.metricsSnapshot.metrics.map((m) => (
                <div key={m.key} className="rounded-lg border px-3 py-2">
                  <dt className="text-xs text-muted-foreground" title={m.kind === "observed" ? "Observed" : "Calculated"}>
                    {m.label} <span className="text-[10px] uppercase">{m.kind === "observed" ? "obs" : "calc"}</span>
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {m.value === null ? (
                      <span className="font-normal text-muted-foreground">n/a</span>
                    ) : m.provisional ? (
                      <NotFinal reason="Wasn't final when captured: recent installs were still converting.">{formatMetric(m, m.value)}</NotFinal>
                    ) : (
                      formatMetric(m, m.value)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function Notice({ title, body, retry }: { title: string; body: string; retry?: string }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border px-6 py-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Link href={retry ?? "/creatives/library"} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}>
        {retry ? "Try again" : "Back to the library"}
      </Link>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading creative">
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="aspect-square rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
