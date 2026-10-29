"use client";

import { SearchIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Input } from "@components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import type { CreativeListQuery } from "@typings/creatives";

const STATUS = [
  { value: "all", label: "Any status" },
  { value: "succeeded", label: "Generated" },
  { value: "failed", label: "Failed" },
  { value: "generating", label: "Generating" },
];
const BASIS = [
  { value: "all", label: "Any basis" },
  { value: "data", label: "Data-informed" },
  { value: "exploratory", label: "Exploratory" },
];

/** Search and filters, kept in the URL so a filtered library can be reloaded or shared. */
export function LibraryFilters({ query }: { query: CreativeListQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(query.q ?? "");
  const [pending, start] = useTransition();

  const go = (patch: Partial<Record<"q" | "status" | "basis", string>>) => {
    const next = { q: query.q ?? "", status: query.status ?? "", basis: query.basis ?? "", ...patch };
    const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v && v !== "all"));
    start(() => router.push(params.size ? `${pathname}?${params}` : pathname));
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      role="search"
      aria-busy={pending}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        go({ q: q.trim() });
      }}
    >
      <div className="relative w-full sm:w-72">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Search creatives" placeholder="Search title, headline, campaign" className="h-8 pl-8" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Select items={STATUS} value={query.status ?? "all"} onValueChange={(v) => v && go({ status: v })}>
        <SelectTrigger aria-label="Status" size="sm" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select items={BASIS} value={query.basis ?? "all"} onValueChange={(v) => v && go({ basis: v })}>
        <SelectTrigger aria-label="Basis" size="sm" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BASIS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </form>
  );
}
