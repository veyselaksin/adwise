"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { type DashboardFilters, filtersToSearch } from "@/lib/filters";

/** Updates the dashboard's URL state; `pending` is true while the new data loads. */
export function useFilterNavigation(current: DashboardFilters) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const update = (patch: Partial<DashboardFilters>) => {
    const next = { ...current, ...patch };
    startTransition(() => router.push(`${pathname}${filtersToSearch(next)}`, { scroll: false }));
  };

  return { update, pending };
}
