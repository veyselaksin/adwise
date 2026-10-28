"use client";

import { ArrowLeftIcon, Loader2Icon, ScanSearchIcon, SquareIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAgentModels } from "@/components/agent/use-agent-models";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, formatDay, formatRange } from "@/lib/format";
import type { Entities } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InvestigationReport } from "./investigation-report";
import { StageList } from "./stage-list";
import { useInvestigation } from "./use-investigation";

type Props = {
  campaigns: Entities["campaigns"];
  bounds: { first: string; last: string };
  initial: { campaignId: string; from: string; to: string };
  /** Start right away (the overview's Investigate button). */
  autorun: boolean;
  /** The overview's query string, so "Back to dashboard" keeps its filters. */
  back: string;
};

const daysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const channelLabel = (channel: string) => (channel === "tiktok" ? "TikTok" : "Meta");

/** Why the chosen period can't be investigated, checked here so the button can say so before a request. */
function problemWith(from: string, to: string, bounds: Props["bounds"]): string | null {
  if (!from || !to) return "Pick both dates.";
  if (from > to) return "The start date must be on or before the end date.";
  if (from < bounds.first || to > bounds.last) return `The data covers ${formatDay(bounds.first)} to ${formatDay(bounds.last)}.`;
  const previousFrom = addDays(from, -daysIn(from, to));
  if (previousFrom < bounds.first) {
    return `The previous ${daysIn(from, to)} days would start on ${formatDay(previousFrom)}, before the data does (${formatDay(bounds.first)}). Pick a later start or a shorter period.`;
  }
  return null;
}

export function InvestigationWorkspace({ campaigns, bounds, initial, autorun, back }: Props) {
  const [campaignId, setCampaignId] = useState(initial.campaignId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const { state, start, stop } = useInvestigation();
  const { model } = useAgentModels();
  const autoran = useRef(false);

  const problem = problemWith(from, to, bounds);
  const days = problem ? 0 : daysIn(from, to);
  const previous = days ? { from: addDays(from, -days), to: addDays(from, -1) } : null;
  const running = state.status === "running";
  const campaignItems = campaigns.map((c) => ({ value: c.id, label: `${c.name} · ${channelLabel(c.channel)} · ${c.country}` }));
  const backHref = back ? `/?${back}` : "/";

  const run = (request = { campaignId, from, to }) => {
    // Keep the URL shareable without a server round trip (and without re-running on reload).
    const params = new URLSearchParams({ campaign: request.campaignId, from: request.from, to: request.to });
    if (back) params.set("back", back);
    window.history.replaceState(null, "", `/investigate?${params}`);
    void start({ ...request, ...(model && { model }) });
  };

  useEffect(() => {
    if (!autorun || autoran.current || problemWith(initial.from, initial.to, bounds)) return;
    autoran.current = true;
    run(initial);
    // Runs once, on arrival from the overview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={backHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 w-fit text-muted-foreground")}>
          <ArrowLeftIcon /> Back to dashboard
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Investigate performance</h1>
        <p className="text-sm text-muted-foreground">
          Compares a campaign&apos;s period with the same number of days just before it. Every figure comes from the
          warehouse; the AI only explains them, and each claim links to its evidence.
        </p>
      </div>

      <Card className="gap-3 px-4 py-3.5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && campaignId && !running) run();
          }}
        >
          <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-auto">
            Campaign
            <Select items={campaignItems} value={campaignId || null} onValueChange={(v) => v && setCampaignId(v)}>
              <SelectTrigger aria-label="Campaign" className="w-full sm:min-w-72">
                <SelectValue placeholder="Choose a campaign" />
              </SelectTrigger>
              <SelectContent>
                {campaignItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input type="date" className="h-8 w-36" min={bounds.first} max={bounds.last} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input type="date" className="h-8 w-36" min={bounds.first} max={bounds.last} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {running ? (
            <Button type="button" variant="outline" onClick={stop}>
              <SquareIcon /> Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!!problem || !campaignId}>
              <ScanSearchIcon /> Investigate performance
            </Button>
          )}
        </form>
        <p className={cn("text-sm", problem ? "text-delta-bad" : "text-muted-foreground")} role={problem ? "alert" : undefined}>
          {problem ??
            (previous &&
              `${formatRange({ from, to })} (${days} ${days === 1 ? "day" : "days"}) compared with ${formatRange(previous)}.`)}
        </p>
      </Card>

      {state.status === "idle" ? (
        <Card className="items-center gap-2 px-4 py-12 text-center">
          <ScanSearchIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Pick a campaign and a period, then start the investigation.</p>
          <p className="max-w-xl text-sm text-muted-foreground">
            You&apos;ll get the period-over-period numbers, what drove the change (funnel steps, ad sets, ads), app
            releases in the window, and an AI reading of the evidence with its limits.
          </p>
        </Card>
      ) : (
        <>
          {(running || !state.facts) && <StageList stages={state.stages} />}
          {running && !state.facts && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Loading the campaign&apos;s numbers…
            </p>
          )}
          <InvestigationReport state={state} />
        </>
      )}
    </>
  );
}
