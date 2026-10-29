import { EyeIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@components/ui/button";
import { formatDay } from "@lib/format";
import type { AnomalyReport } from "@typings/anomalies";

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** One line for the low flags left out of the list, with a link that shows them. */
export function HiddenCapped({ hidden, showHref }: { hidden: NonNullable<AnomalyReport["hiddenCapped"]>; showHref: string }) {
  if (hidden.total === 0) return null;
  const lines = [
    ...hidden.settling.map(
      (d) =>
        `${formatDay(d.date)}: ${list(d.metrics)} flagged in ${d.campaigns} campaign${d.campaigns === 1 ? "" : "s"}. It's the newest day the team counts as final and still filling in, so it reads high across the account.`,
    ),
    ...(hidden.smallSample > 0
      ? [`${hidden.smallSample} flag${hidden.smallSample === 1 ? "" : "s"} on fewer than 20 subscriptions, too small a sample to call (team note 6).`]
      : []),
  ];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1 text-muted-foreground">
        <p className="font-medium text-foreground">
          {hidden.total} low flag{hidden.total === 1 ? "" : "s"} hidden
        </p>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <Link href={showHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <EyeIcon /> Show them
      </Link>
    </div>
  );
}
