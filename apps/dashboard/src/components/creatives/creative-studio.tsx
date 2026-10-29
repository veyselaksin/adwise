"use client";

import { AlertTriangleIcon, InfoIcon, Loader2Icon, RefreshCwIcon, ShieldCheckIcon, SparklesIcon, Undo2Icon, WandSparklesIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { loadContext, suggestBriefFields, writeConcepts } from "@app/creatives/actions";
import { useAgentModels } from "@components/agent/use-agent-models";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { Skeleton } from "@components/ui/skeleton";
import { Textarea } from "@components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { ASPECT_RATIO_LABELS, BRIEF_FIELDS, channelName } from "@lib/creatives";
import { formatDay, formatRange } from "@lib/format";
import { cn } from "@lib/utils";
import type { Entities } from "@typings/entities";
import type { AspectRatio, BriefField, BriefSuggestion, ConceptsResult, CreativeBrief, CreativeContext, CreativeSource, StudioConfig } from "@typings/creatives";
import { ConceptCard } from "./concept-card";
import { CreativeEditor, SetupNote } from "./creative-editor";
import { PerformanceSummary } from "./performance-summary";

type Props = {
  entities: Entities;
  config: StudioConfig;
  initial: { campaignId: string; from: string; to: string };
};

type Mode = "campaign" | "exploratory";
type Loadable<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; data: T } | { status: "error"; code: string; message: string };

const ALL = "__all";
const daysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * The studio's flow: pick what the creative is for (or go exploratory), read its
 * measured performance, write concepts with the text model, then edit one and
 * generate an image. Concepts and images are separate steps, so nothing is paid
 * for until a concept has been reviewed.
 */
export function CreativeStudio({ entities, config, initial }: Props) {
  const [mode, setMode] = useState<Mode>("campaign");
  const [campaignId, setCampaignId] = useState(initial.campaignId);
  const [adsetId, setAdsetId] = useState("");
  const [adId, setAdId] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [loaded, setLoaded] = useState<{ key: string; state: Loadable<CreativeContext> } | null>(null);
  const [reload, setReload] = useState(0);

  const [brief, setBrief] = useState<CreativeBrief>({});
  const [suggested, setSuggested] = useState<Partial<Record<BriefField, BriefSuggestion>>>({});
  const [suggesting, setSuggesting] = useState<Loadable<{ filled: number; removed: number }>>({ status: "idle" });
  const [ratio, setRatio] = useState<AspectRatio>(config.image.defaultAspectRatio);
  const [concepts, setConcepts] = useState<Loadable<ConceptsResult>>({ status: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const { model } = useAgentModels();
  const writing = useRef(false);

  const bounds = config.data;
  const dateProblem =
    !from || !to
      ? "Pick both dates."
      : from > to
        ? "The start date must be on or before the end date."
        : from < bounds.firstDate || to > bounds.lastDate
          ? `The data covers ${formatDay(bounds.firstDate)} to ${formatDay(bounds.lastDate)}.`
          : daysIn(from, to) > config.limits.maxDays
            ? `Pick at most ${config.limits.maxDays} days.`
            : null;
  const source: CreativeSource | null =
    mode === "campaign" && campaignId && !dateProblem ? { campaignId, ...(adsetId && { adsetId }), ...(adsetId && adId && { adId }), from, to } : null;
  const sourceKey = source ? JSON.stringify(source) : "";

  // Measured context loads on its own when the selection changes: it's a database read, no model, no cost.
  const requestKey = sourceKey ? `${reload}#${sourceKey}` : "";
  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    const settle = (state: Loadable<CreativeContext>) => !cancelled && setLoaded({ key: requestKey, state });
    loadContext(JSON.parse(requestKey.slice(requestKey.indexOf("#") + 1)) as CreativeSource)
      .then((res) => settle(res.ok ? { status: "ready", data: res.data } : { status: "error", code: res.code, message: res.error }))
      .catch(() => settle({ status: "error", code: "NETWORK_ERROR", message: "Couldn't reach the server. Check your connection." }));
    return () => {
      cancelled = true;
    };
  }, [requestKey]);
  const context: Loadable<CreativeContext> = !requestKey ? { status: "idle" } : loaded?.key === requestKey ? loaded.state : { status: "loading" };

  const adsets = entities.adsets.filter((a) => a.campaign_id === campaignId);
  const ads = entities.ads.filter((a) => a.adset_id === adsetId);
  const campaignItems = entities.campaigns.map((c) => ({ value: c.id, label: `${c.name} · ${channelName(c.channel)} · ${c.country}` }));
  const adsetItems = [{ value: ALL, label: "All ad sets" }, ...adsets.map((a) => ({ value: a.id, label: `${a.name}${a.status === "active" ? "" : ` · ${a.status}`}` }))];
  const adItems = [{ value: ALL, label: "All ads in the ad set" }, ...ads.map((a) => ({ value: a.id, label: `${a.name} · ${a.creative_type}${a.status === "active" ? "" : ` · ${a.status}`}` }))];

  const contextReady = context.status === "ready";
  const canWrite =
    config.concepts.enabled && concepts.status !== "loading" && (mode === "exploratory" || (contextReady && !!source)) && !Object.values(brief).some((v) => (v?.length ?? 0) > config.limits.briefField);

  async function write() {
    if (!canWrite || writing.current) return;
    writing.current = true;
    setConcepts({ status: "loading" });
    setSelected(null);
    try {
      const clean = Object.fromEntries(Object.entries(brief).filter(([, v]) => v?.trim())) as CreativeBrief;
      const res = await writeConcepts({ ...(mode === "campaign" && source && { source }), brief: clean, aspectRatio: ratio, ...(model && { model }) });
      setConcepts(res.ok ? { status: "ready", data: res.data } : { status: "error", code: res.code, message: res.error });
    } catch {
      setConcepts({ status: "error", code: "NETWORK_ERROR", message: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      writing.current = false;
    }
  }

  // A field still holding the AI's text, unedited, is labeled as a suggestion.
  const isSuggestion = (field: BriefField) => !!suggested[field] && brief[field] === suggested[field]!.value;
  const emptyFields = BRIEF_FIELDS.filter((f) => !brief[f.key]?.trim());
  const canSuggest = config.concepts.enabled && suggesting.status !== "loading" && emptyFields.length > 0 && (mode === "exploratory" || !!source);

  async function suggest() {
    if (!canSuggest) return;
    setSuggesting({ status: "loading" });
    try {
      const filled = Object.fromEntries(Object.entries(brief).filter(([, v]) => v?.trim())) as CreativeBrief;
      const res = await suggestBriefFields({ ...(mode === "campaign" && source && { source }), brief: filled, ...(model && { model }) });
      if (!res.ok) return setSuggesting({ status: "error", code: res.code, message: res.error });
      // Only fields that are still empty: anything typed while the AI was working wins.
      const { suggestions } = res.data;
      setBrief((current) => {
        const out = { ...current };
        for (const s of suggestions) if (!out[s.field]?.trim()) out[s.field] = s.value;
        return out;
      });
      setSuggested((current) => ({ ...current, ...Object.fromEntries(suggestions.map((s) => [s.field, s])) }));
      setSuggesting({ status: "ready", data: { filled: suggestions.length, removed: res.data.removed } });
    } catch {
      setSuggesting({ status: "error", code: "NETWORK_ERROR", message: "Couldn't reach the server. Check your connection and try again." });
    }
  }

  function clearSuggestions() {
    setBrief((current) => {
      const out = { ...current };
      for (const f of BRIEF_FIELDS) if (suggested[f.key] && out[f.key] === suggested[f.key]!.value) delete out[f.key];
      return out;
    });
    setSuggested({});
    setSuggesting({ status: "idle" });
  }
  const anySuggestion = BRIEF_FIELDS.some((f) => isSuggestion(f.key));

  const result = concepts.status === "ready" ? concepts.data : null;
  const chosen = result?.concepts.find((c) => c.conceptId === selected) ?? null;
  // The concepts belong to the selection they were written for, not whatever is picked now.
  const stale = !!result && (result.context ? JSON.stringify(result.context.source) !== sourceKey || mode !== "campaign" : mode !== "exploratory");

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>1 · What is the creative for?</CardTitle>
          <CardDescription>Pick a campaign (optionally an ad set or ad) to build on its measured performance, or start from a brief alone.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ToggleGroup variant="outline" size="sm" spacing={0} aria-label="Basis" value={[mode]} onValueChange={(v: string[]) => v[0] && setMode(v[0] as Mode)}>
            <ToggleGroupItem value="campaign">From a campaign</ToggleGroupItem>
            <ToggleGroupItem value="exploratory">Exploratory brief</ToggleGroupItem>
          </ToggleGroup>
          {mode === "campaign" ? (
            <div className="flex flex-wrap items-end gap-3">
              <Picker label="Campaign" className="w-full sm:w-auto sm:min-w-72">
                <Select items={campaignItems} value={campaignId || null} onValueChange={(v) => {
                  if (!v) return;
                  setCampaignId(v);
                  setAdsetId("");
                  setAdId("");
                }}>
                  <SelectTrigger aria-label="Campaign" className="w-full">
                    <SelectValue placeholder="Choose a campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaignItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Picker>
              <Picker label="Ad set" className="w-full sm:w-auto sm:min-w-52">
                <Select items={adsetItems} value={adsetId || ALL} disabled={!campaignId} onValueChange={(v) => {
                  setAdsetId(!v || v === ALL ? "" : v);
                  setAdId("");
                }}>
                  <SelectTrigger aria-label="Ad set" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {adsetItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Picker>
              <Picker label="Ad" className="w-full sm:w-auto sm:min-w-52">
                <Select items={adItems} value={adId || ALL} disabled={!adsetId} onValueChange={(v) => setAdId(!v || v === ALL ? "" : v)}>
                  <SelectTrigger aria-label="Ad" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {adItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Picker>
              <Picker label="From">
                <Input type="date" className="h-8 w-36" min={bounds.firstDate} max={bounds.lastDate} value={from} onChange={(e) => setFrom(e.target.value)} />
              </Picker>
              <Picker label="To">
                <Input type="date" className="h-8 w-36" min={bounds.firstDate} max={bounds.lastDate} value={to} onChange={(e) => setTo(e.target.value)} />
              </Picker>
            </div>
          ) : (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Exploratory concepts use only your brief. They make no performance claims and are labeled as exploratory everywhere they appear.
            </p>
          )}
          {mode === "campaign" && dateProblem && (
            <p className="text-sm text-delta-bad" role="alert">
              {dateProblem}
            </p>
          )}
        </CardContent>
      </Card>

      {mode === "campaign" && <ContextArea state={context} hasCampaign={!!campaignId} onRetry={() => setReload((n) => n + 1)} />}

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>2 · Brief (optional)</CardTitle>
          <CardDescription>
            What you type here is passed to the AI as your own claim, not as data. Leave a field empty rather than guess, or let the AI suggest the empty
            ones{mode === "campaign" ? " from this selection" : ""}, then review them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void suggest()} disabled={!canSuggest}>
              {suggesting.status === "loading" ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
              {suggesting.status === "loading"
                ? "Suggesting…"
                : emptyFields.length === BRIEF_FIELDS.length
                  ? "Suggest a brief with AI"
                  : emptyFields.length > 0
                    ? `Suggest the ${emptyFields.length} empty field${emptyFields.length === 1 ? "" : "s"}`
                    : "Every field is filled"}
            </Button>
            {anySuggestion && (
              <Button variant="ghost" size="sm" onClick={clearSuggestions} disabled={suggesting.status === "loading"}>
                <Undo2Icon /> Clear unedited suggestions
              </Button>
            )}
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {suggesting.status === "loading"
                ? "Reading the selection… usually 5–20 s. Fields you type in meanwhile are kept."
                : suggesting.status === "ready"
                  ? suggesting.data.filled === 0
                    ? "No usable suggestions came back. Try again or fill the fields yourself."
                    : `Filled ${suggesting.data.filled} field${suggesting.data.filled === 1 ? "" : "s"}. They're AI suggestions, not data: edit or clear what doesn't fit.${suggesting.data.removed > 0 ? ` ${suggesting.data.removed} unusable suggestion${suggesting.data.removed === 1 ? " was" : "s were"} dropped.` : ""}`
                  : mode === "campaign" && !source
                    ? "Pick a campaign first, or switch to an exploratory brief."
                    : "Text only, no image cost."}
            </p>
          </div>
          {suggesting.status === "error" && (
            <p role="alert" className="text-sm text-delta-bad">
              Couldn&apos;t suggest a brief: {suggesting.message}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {BRIEF_FIELDS.map((f) => {
              const value = brief[f.key] ?? "";
              const over = value.length > config.limits.briefField;
              return (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`brief-${f.key}`}>{f.label}</Label>
                    {value.length > config.limits.briefField * 0.8 && (
                      <span className={cn("text-xs tabular-nums", over ? "text-delta-bad" : "text-muted-foreground")}>
                        {value.length}/{config.limits.briefField}
                      </span>
                    )}
                  </div>
                  <Textarea
                    id={`brief-${f.key}`}
                    rows={2}
                    placeholder={f.placeholder}
                    value={value}
                    aria-invalid={over}
                    onChange={(e) => setBrief((b) => ({ ...b, [f.key]: e.target.value }))}
                    className={cn(isSuggestion(f.key) && "border-dashed bg-muted/30")}
                  />
                  {isSuggestion(f.key) && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="shrink-0">
                        <SparklesIcon /> AI · {suggested[f.key]!.basis === "data" ? "from the data" : "assumption"}
                      </Badge>
                      <span>{suggested[f.key]!.note}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Picker label="Preferred format" className="w-full sm:w-72">
              <Select items={config.image.aspectRatios.map((r) => ({ value: r, label: ASPECT_RATIO_LABELS[r] }))} value={ratio} onValueChange={(v) => v && setRatio(v as AspectRatio)}>
                <SelectTrigger aria-label="Preferred format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.image.aspectRatios.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ASPECT_RATIO_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Picker>
            <Button onClick={() => void write()} disabled={!canWrite}>
              {concepts.status === "loading" ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
              {concepts.status === "loading" ? "Writing concepts…" : result ? "Write new concepts" : "Generate concepts"}
            </Button>
          </div>
          {!config.concepts.enabled && <p className="text-sm text-delta-bad">{config.concepts.disabledReason}</p>}
          {mode === "campaign" && !contextReady && config.concepts.enabled && (
            <p className="text-xs text-muted-foreground">Load the selection&apos;s performance first, or switch to an exploratory brief.</p>
          )}
          <p className="text-xs text-muted-foreground">Concepts are text only and free of image costs. Nothing is saved until you generate an image.</p>
        </CardContent>
      </Card>

      {concepts.status === "loading" && (
        <section aria-busy="true" aria-label="Writing concepts" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Writing concepts from{" "}
            {mode === "campaign" && context.status === "ready" && context.data.status === "ok" ? "the measured performance" : "your brief"}… this usually takes 15–40 s.
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-96 rounded-xl" />
            ))}
          </div>
        </section>
      )}

      {concepts.status === "error" && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangleIcon className="size-4 text-destructive" aria-hidden="true" /> Couldn&apos;t write concepts
          </p>
          <p className="text-muted-foreground">{concepts.message}</p>
          {concepts.code !== "AGENT_DISABLED" && (
            <Button variant="outline" size="sm" className="w-fit" onClick={() => void write()} disabled={!canWrite}>
              <RefreshCwIcon /> Try again
            </Button>
          )}
        </div>
      )}

      {result && (
        <section aria-label="Concepts" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
              3 · Concepts
              {result.dataInformed ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheckIcon aria-hidden="true" /> Performance-informed
                </Badge>
              ) : (
                <Badge variant="outline">Exploratory, not performance-informed</Badge>
              )}
            </h2>
            <p className="text-sm text-muted-foreground">
              {result.dataInformed && result.context
                ? `Written by ${result.model.label} from ${result.context.campaign.name}${result.context.adset ? ` › ${result.context.adset.name}` : ""}${result.context.ad ? ` › ${result.context.ad.name}` : ""}, ${formatRange(result.context.range)}. Evidence lines are measured; everything else is the AI's proposal. A concept isn't a prediction: test it.`
                : `Written by ${result.model.label}. ${result.exploratoryReason} These concepts make no claims about performance.`}
              {result.removed > 0 && ` The guardrails removed ${result.removed} statement${result.removed === 1 ? "" : "s"} that cited data that doesn't exist.`}
            </p>
            {stale && (
              <p className="flex items-center gap-1.5 text-sm text-provisional">
                <InfoIcon className="size-4" aria-hidden="true" /> The selection changed since these were written; they still use the earlier one. Write new concepts to update them.
              </p>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {result.concepts.map((c, i) => (
              <ConceptCard key={c.conceptId} concept={c} index={i} dataInformed={result.dataInformed} selected={c.conceptId === selected} onSelect={() => setSelected(c.conceptId)} />
            ))}
          </div>
        </section>
      )}

      {result && chosen && (
        <section aria-label="Generate" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">4 · Image</h2>
          {!config.image.enabled && <SetupNote reason={config.image.disabledReason} />}
          <CreativeEditor
            key={chosen.conceptId}
            draft={{ concept: chosen, ...(result.context && { source: result.context.source }), dataInformed: result.dataInformed }}
            image={config.image}
            limits={config.limits}
          />
        </section>
      )}
    </div>
  );
}

function ContextArea({ state, hasCampaign, onRetry }: { state: Loadable<CreativeContext>; hasCampaign: boolean; onRetry: () => void }) {
  if (state.status === "idle") {
    return (
      <Card className="items-center gap-1 px-4 py-8 text-center text-sm text-muted-foreground">
        {hasCampaign ? "Fix the dates above to load the performance." : "Choose a campaign to see its measured performance."}
      </Card>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading performance">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium">Couldn&apos;t load the performance</p>
        <p className="text-muted-foreground">{state.message}</p>
        <Button variant="outline" size="sm" className="w-fit" onClick={onRetry}>
          <RefreshCwIcon /> Try again
        </Button>
      </div>
    );
  }
  return <PerformanceSummary context={state.data} />;
}

function Picker({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}
