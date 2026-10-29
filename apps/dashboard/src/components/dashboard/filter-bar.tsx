"use client";

import { CalendarIcon, Loader2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CHANNELS, COUNTRIES, PRESET_LABELS } from "@/constants/filters.constant";
import type { DateRange, RangePreset } from "@/types/dates.type";
import type { DashboardFilters } from "@/types/filters.type";
import { formatRange } from "@/lib/format";
import { useFilterNavigation } from "./use-filter-navigation";

type Props = {
  filters: DashboardFilters;
  /** The range the current view resolved to. */
  range: DateRange;
  bounds: { first: string; last: string };
};

const periodItems = [
  ...Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label })),
  { value: "custom", label: "Custom range" },
];
const countryItems = [{ value: "all", label: "All countries" }, ...COUNTRIES];

export function FilterBar({ filters, range, bounds }: Props) {
  const { update, pending } = useFilterNavigation(filters);

  const setPeriod = (value: string | null) => {
    if (!value) return;
    if (value === "custom") update({ preset: "custom", range });
    else update({ preset: value as RangePreset, range: undefined });
  };
  const setCustom = (patch: Partial<DateRange>) => {
    const next = { ...range, ...patch };
    if (next.from && next.to && next.from <= next.to) update({ preset: "custom", range: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select items={periodItems} value={filters.preset} onValueChange={setPeriod}>
        <SelectTrigger aria-label="Period" className="min-w-44">
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

      {filters.preset === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="From"
            className="h-8 w-36"
            min={bounds.first}
            max={bounds.last}
            value={range.from}
            onChange={(e) => setCustom({ from: e.target.value })}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To"
            className="h-8 w-36"
            min={bounds.first}
            max={bounds.last}
            value={range.to}
            onChange={(e) => setCustom({ to: e.target.value })}
          />
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

      {pending && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2Icon className="size-3.5 animate-spin" /> Updating…
        </span>
      )}
    </div>
  );
}
