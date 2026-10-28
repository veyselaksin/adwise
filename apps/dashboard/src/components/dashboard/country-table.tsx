import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHANNELS, COUNTRIES } from "@/lib/filters";
import { formatPct, formatRange, formatUsd } from "@/lib/format";
import { combineRows } from "@/lib/metrics";
import type { DateRange, MetricRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NotFinal } from "./not-final";

/** Team note 6: don't call a winner below 20 subscriptions. */
const MIN_SUBSCRIPTIONS = 20;

type Props = {
  rows: MetricRow[];
  range: DateRange;
  /** Days left out because CAC isn't final for them yet. */
  excluded?: DateRange;
};

/**
 * Team note 7: compare channels within each country first, then give the
 * blended number, because most TikTok spend is in Brazil.
 */
export function CountryTable({ rows, range, excluded }: Props) {
  const channels = CHANNELS.filter((c) => rows.some((r) => r.channel === c.value));
  const countries = COUNTRIES.filter((c) => rows.some((r) => r.country === c.value));
  const cell = (country: string, channel: string) =>
    rows.find((r) => r.country === country && r.channel === channel);
  const blended = channels.map((c) => combineRows(rows.filter((r) => r.channel === c.value)));
  const roasNotFinal = rows.some((r) => r.provisional.includes("d7_roas"));

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Channels within each country</CardTitle>
        <CardDescription>
          CAC and D7 ROAS for {formatRange(range)}.{" "}
          {excluded && `${formatRange(excluded)} left out: CAC isn't final for days less than 4 days old. `}
          The cheaper channel is marked when both have at least {MIN_SUBSCRIPTIONS} subscriptions.
        </CardDescription>
      </CardHeader>
      <div className="px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="align-bottom">
                Country
              </TableHead>
              {channels.map((c) => (
                <TableHead key={c.value} colSpan={3} className="border-l text-center">
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              {channels.map((c) => (
                <SubHeads key={c.value} roasNotFinal={roasNotFinal} />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {countries.map((country) => {
              const cells = channels.map((c) => cell(country.value, c.value));
              const comparable = cells.filter((r): r is MetricRow => !!r && r.subscriptions >= MIN_SUBSCRIPTIONS);
              const cheapest =
                cells.length > 1 && comparable.length === cells.length
                  ? comparable.reduce((a, b) => ((a.cac ?? Infinity) <= (b.cac ?? Infinity) ? a : b))
                  : undefined;
              return (
                <TableRow key={country.value}>
                  <TableCell className="font-medium">{country.label}</TableCell>
                  {cells.map((r, i) => (
                    <Cells key={channels[i]!.value} row={r} best={!!r && r === cheapest} />
                  ))}
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
              <TableCell>Blended</TableCell>
              {blended.map((r, i) => (
                <Cells key={channels[i]!.value} row={r} />
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function SubHeads({ roasNotFinal }: { roasNotFinal: boolean }) {
  return (
    <>
      <TableHead className="border-l text-right">Spend</TableHead>
      <TableHead className="text-right">CAC</TableHead>
      <TableHead className="text-right">
        {roasNotFinal ? (
          <NotFinal reason="Includes install days less than 7 days old; their D7 revenue is still coming in.">
            D7 ROAS
          </NotFinal>
        ) : (
          "D7 ROAS"
        )}
      </TableHead>
    </>
  );
}

function Cells({ row, best }: { row?: MetricRow; best?: boolean }) {
  if (!row) {
    return (
      <>
        <TableCell className="border-l text-right text-muted-foreground">—</TableCell>
        <TableCell className="text-right text-muted-foreground">—</TableCell>
        <TableCell className="text-right text-muted-foreground">—</TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell className="border-l text-right tabular-nums">{formatUsd(row.spend)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", best && "font-semibold")}>
        {best && <span className="sr-only">Cheaper channel: </span>}
        {formatUsd(row.cac)}
        {best && <span aria-hidden="true" className="ml-1 text-delta-good">●</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatPct(row.d7_roas)}</TableCell>
    </>
  );
}
