"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { RUN_STATUS_FILTERS } from "@constants/observability";
import { type ObsState, obsHref } from "@lib/observability";
import type { RunStatusFilter } from "@typings/observability";

type Props = { state: ObsState; models: string[]; tools: string[] };

/** Status, model, tool, duration bounds (seconds) and an id search; every change is a new URL. */
export function RunFilters({ state, models, tools }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(state.q ?? "");
  const [minS, setMinS] = useState(state.minMs === undefined ? "" : String(state.minMs / 1000));
  const [maxS, setMaxS] = useState(state.maxMs === undefined ? "" : String(state.maxMs / 1000));
  const update = (patch: Partial<ObsState>) => startTransition(() => router.push(obsHref({ ...state, page: 1, ...patch }), { scroll: false }));

  const modelItems = [{ value: "all", label: "All models" }, ...models.map((m) => ({ value: m, label: m }))];
  const toolItems = [{ value: "all", label: "Any tool" }, ...tools.map((t) => ({ value: t, label: t }))];
  const toMs = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) || Number(s) < 0 ? undefined : Math.round(Number(s) * 1000));
  const filtered = !!(state.status || state.model || state.tool || state.minMs !== undefined || state.maxMs !== undefined || state.q);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: /^[A-Za-z0-9-]{4,64}$/.test(q.trim()) ? q.trim() : undefined });
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Run or trace id (4+ chars)" aria-label="Search by run id or trace id" className="h-8 w-56 font-mono text-xs" />
        <Button type="submit" variant="outline" size="icon-sm" aria-label="Search">
          <SearchIcon />
        </Button>
      </form>

      <Select items={RUN_STATUS_FILTERS} value={state.status ?? "all"} onValueChange={(v) => v && update({ status: v === "all" ? undefined : (v as RunStatusFilter) })}>
        <SelectTrigger size="sm" aria-label="Status" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RUN_STATUS_FILTERS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={modelItems} value={state.model ?? "all"} onValueChange={(v) => v && update({ model: v === "all" ? undefined : v })}>
        <SelectTrigger size="sm" aria-label="Model" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {modelItems.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={toolItems} value={state.tool ?? "all"} onValueChange={(v) => v && update({ tool: v === "all" ? undefined : v })}>
        <SelectTrigger size="sm" aria-label="Called tool" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {toolItems.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <form
        className="flex items-center gap-1 text-sm text-muted-foreground"
        onSubmit={(e) => {
          e.preventDefault();
          update({ minMs: toMs(minS), maxMs: toMs(maxS) });
        }}
      >
        <Input value={minS} onChange={(e) => setMinS(e.target.value)} inputMode="decimal" placeholder="min s" aria-label="Minimum duration, seconds" className="h-8 w-20" />
        –
        <Input value={maxS} onChange={(e) => setMaxS(e.target.value)} inputMode="decimal" placeholder="max s" aria-label="Maximum duration, seconds" className="h-8 w-20" />
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            setMinS("");
            setMaxS("");
            update({ status: undefined, model: undefined, tool: undefined, minMs: undefined, maxMs: undefined, q: undefined });
          }}
        >
          <XIcon /> Clear filters
        </Button>
      )}
    </div>
  );
}
