"use client";

import { ArrowDownUpIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import type { InsightQuery } from "@typings/insights";

const sortItems = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

/** Library filters live in the URL, like the overview's, so a filtered list can be shared too. */
export function InsightFilters({ query }: { query: InsightQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query.q ?? "");

  const update = useCallback(
    (patch: Partial<InsightQuery>) => {
      const next = { ...query, ...patch };
      const params = new URLSearchParams();
      if (next.q) params.set("q", next.q);
      if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);
      startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
    },
    [query, pathname, router],
  );

  // Search as you type, after a short pause.
  useEffect(() => {
    const q = text.trim();
    if (q === (query.q ?? "")) return;
    const t = setTimeout(() => update({ q: q || undefined }), 300);
    return () => clearTimeout(t);
  }, [text, query.q, update]);

  const filtered = !!(query.q || query.from || query.to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search titles, questions, campaigns"
          aria-label="Search insights"
          className="h-8 pl-8"
          maxLength={200}
        />
      </div>

      <Select items={sortItems} value={query.sort ?? "newest"} onValueChange={(v) => v && update({ sort: v as InsightQuery["sort"] })}>
        <SelectTrigger aria-label="Sort" className="min-w-36">
          <ArrowDownUpIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Saved</span>
        <Input
          type="date"
          aria-label="Saved from"
          className="h-8 w-36"
          value={query.from ?? ""}
          max={query.to}
          onChange={(e) => update({ from: e.target.value || undefined })}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="date"
          aria-label="Saved to"
          className="h-8 w-36"
          value={query.to ?? ""}
          min={query.from}
          onChange={(e) => update({ to: e.target.value || undefined })}
        />
      </div>

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText("");
            update({ q: undefined, from: undefined, to: undefined });
          }}
        >
          <XIcon /> Clear
        </Button>
      )}
      {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
    </div>
  );
}
