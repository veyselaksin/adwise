"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { Switch } from "@components/ui/switch";
import { LOG_LEVEL_FILTERS } from "@constants/observability";
import { type ObsState, obsHref } from "@lib/observability";
import type { LogLevel } from "@typings/observability";

/** Level, errors-only, component and a run/trace/request id; each change starts again from the newest line. */
export function LogFilters({ state, components }: { state: ObsState; components: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cid, setCid] = useState(state.cid ?? "");
  const update = (patch: Partial<ObsState>) => startTransition(() => router.push(obsHref({ ...state, before: undefined, ...patch }), { scroll: false }));
  const componentItems = [{ value: "all", label: "All components" }, ...components.map((c) => ({ value: c, label: c }))];
  const filtered = !!(state.level || state.errorsOnly || state.component || state.cid);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          update({ cid: /^[A-Za-z0-9-]{1,64}$/.test(cid.trim()) ? cid.trim() : undefined });
        }}
      >
        <Input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="Run, trace or request id" aria-label="Correlation id" className="h-8 w-56 font-mono text-xs" />
        <Button type="submit" variant="outline" size="icon-sm" aria-label="Filter by id">
          <SearchIcon />
        </Button>
      </form>

      <Select items={LOG_LEVEL_FILTERS} value={state.level ?? "all"} onValueChange={(v) => v && update({ level: v === "all" ? undefined : (v as LogLevel) })}>
        <SelectTrigger size="sm" aria-label="Minimum level" className="min-w-44" disabled={state.errorsOnly}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOG_LEVEL_FILTERS.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={componentItems} value={state.component ?? "all"} onValueChange={(v) => v && update({ component: v === "all" ? undefined : v })}>
        <SelectTrigger size="sm" aria-label="Component" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {componentItems.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2 pl-1">
        <Switch id="errors-only" checked={!!state.errorsOnly} onCheckedChange={(checked: boolean) => update({ errorsOnly: checked || undefined })} />
        <Label htmlFor="errors-only" className="text-sm font-normal text-muted-foreground">
          Errors only
        </Label>
      </div>

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCid("");
            update({ level: undefined, errorsOnly: undefined, component: undefined, cid: undefined });
          }}
        >
          <XIcon /> Clear filters
        </Button>
      )}
    </div>
  );
}
