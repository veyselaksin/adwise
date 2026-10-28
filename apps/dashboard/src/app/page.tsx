import { LogOutIcon } from "lucide-react";
import { Suspense } from "react";
import { AgentProvider } from "@/components/agent/agent-provider";
import { AgentToggle } from "@/components/agent/agent-toggle";
import { Brand } from "@/components/brand";
import { CountryTable } from "@/components/dashboard/country-table";
import { DrilldownTable } from "@/components/dashboard/drilldown-table";
import { ExportMenu } from "@/components/dashboard/export-menu";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { loadDashboard } from "@/components/dashboard/load-dashboard";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { filtersToSearch, parseFilters } from "@/lib/filters";
import { formatDay } from "@/lib/format";
import { signOut } from "./login/actions";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <AgentProvider>
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-2">
            <AgentToggle />
            <ThemeSwitcher />
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                <LogOutIcon /> Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Dashboard searchParams={searchParams} />
        </Suspense>
      </main>
    </AgentProvider>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const filters = parseFilters(await searchParams);
  const data = await loadDashboard(filters);
  const { catalog, defs } = data;
  const search = filtersToSearch(filters);

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Data through {formatDay(catalog.lastDataDate)} (yesterday). CAC is final through{" "}
            {formatDay(defs.cac.lastFinalDate)}, trial → sub through {formatDay(defs.trial_to_sub.lastFinalDate)}, D7
            ROAS through {formatDay(defs.d7_roas.lastFinalDate)}.
          </p>
        </div>
        <ExportMenu search={search} />
      </div>
      <FilterBar
        filters={filters}
        range={data.range}
        bounds={{ first: catalog.firstDataDate, last: catalog.lastDataDate }}
      />
      <KpiGrid tiles={data.tiles} previousRange={data.previousRange} />
      <TrendChart filters={filters} range={data.range} rows={data.series} defs={defs} />
      <CountryTable rows={data.countries.rows} range={data.countries.range} excluded={data.countries.excluded} />
      <DrilldownTable {...data.drilldown} defs={defs} search={search} />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-12 w-96 max-w-full" />
      <Skeleton className="h-8 w-[36rem] max-w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Card key={i} className="h-28 px-4 py-3.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-28" />
          </Card>
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
