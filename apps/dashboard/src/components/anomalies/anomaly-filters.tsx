"use client";

import { CalendarIcon, Loader2Icon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { Switch } from "@components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { ANOMALY_RANGES, ANOMALY_TYPE_LABELS } from "@constants/anomalies";
import { CHANNELS, COUNTRIES } from "@constants/filters";
import { type AnomalyFilters as Filters, type AnomalyPeriod, anomalyFiltersToSearch } from "@lib/anomaly-filters";
import { formatRange } from "@lib/format";
import type { AnomalyType } from "@typings/anomalies";
import type { DateRange } from "@typings/dates";

const periodItems = [
  ...ANOMALY_RANGES.map((d) => ({ value: `${d}`, label: `Last ${d} days` })),
  { value: "all", label: "All data" },
  { value: "custom", label: "Custom range" },
];
const countryItems = [{ value: "all", label: "All countries" }, ...COUNTRIES];
const typeItems = [
  { value: "all", label: "All anomaly types" },
  ...Object.entries(ANOMALY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

type Props = { filters: Filters; range: DateRange; bounds: { first: string; last: string } };

export function AnomalyFilters({ filters, range, bounds }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const update = (patch: Partial<Filters>) =>
    startTransition(() => router.push(`${pathname}${anomalyFiltersToSearch({ ...filters, ...patch })}`, { scroll: false }));

  const setPeriod = (value: string | null) => {
    if (!value) return;
    update(value === "custom" ? { period: "custom", range } : { period: value as AnomalyPeriod, range: undefined });
  };
  const setCustom = (patch: Partial<DateRange>) => {
    const next = { ...range, ...patch };
    if (next.from && next.to && next.from <= next.to) update({ period: "custom", range: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select items={periodItems} value={filters.period} onValueChange={setPeriod}>
        <SelectTrigger aria-label="Days to check" className="min-w-40">
          <CalendarIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periodItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filters.period === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From" className="h-8 w-36" min={bounds.first} max={bounds.last} value={range.from} onChange={(e) => setCustom({ from: e.target.value })} />
          <span className="text-muted-foreground">–</span>
          <Input type="date" aria-label="To" className="h-8 w-36" min={bounds.first} max={bounds.last} value={range.to} onChange={(e) => setCustom({ to: e.target.value })} />
        </div>
      ) : (
        <span className="text-sm text-muted-foreground tabular-nums">{formatRange(range)}</span>
      )}

      <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Channel"
        value={[filters.channel]}
        onValueChange={(value: string[]) => value[0] && update({ channel: value[0] })}
      >
        <ToggleGroupItem value="all">All channels</ToggleGroupItem>
        {CHANNELS.map((c) => (
          <ToggleGroupItem key={c.value} value={c.value}>
            {c.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Select items={countryItems} value={filters.country} onValueChange={(v) => v && update({ country: v })}>
        <SelectTrigger aria-label="Country" size="sm" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {countryItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={typeItems} value={filters.type} onValueChange={(v) => v && update({ type: v as AnomalyType | "all" })}>
        <SelectTrigger aria-label="Anomaly type" size="sm" className="min-w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {typeItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2 pl-1">
        <Switch id="show-capped" checked={filters.showCapped} onCheckedChange={(checked: boolean) => update({ showCapped: checked })} />
        <Label htmlFor="show-capped" className="text-sm font-normal text-muted-foreground">
          Show capped flags
        </Label>
      </div>

      {pending && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2Icon className="size-3.5 animate-spin" /> Checking…
        </span>
      )}
    </div>
  );
}
