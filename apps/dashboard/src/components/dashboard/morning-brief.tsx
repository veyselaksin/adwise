import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, ScanSearchIcon, SunriseIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@components/ui/button";
import { getBrief } from "@lib/api";
import { formatDay, formatRange } from "@lib/format";
import type { BriefItem } from "@typings/brief";
import { cn } from "@lib/utils";
import { BriefFrame } from "./brief-frame";

const TONE = {
  bad: { Icon: AlertTriangleIcon, className: "text-delta-bad", label: "Needs a look" },
  good: { Icon: CheckCircle2Icon, className: "text-delta-good", label: "Good news" },
  info: { Icon: InfoIcon, className: "text-muted-foreground", label: "For context" },
} as const;

/**
 * What changed yesterday, from the server's fixed checks (no model): the first
 * thing the team reads in the morning. Covers every campaign, whatever the filters.
 */
export async function MorningBrief({ search }: { search: string }) {
  const brief = await getBrief();
  const count = (tone: BriefItem["tone"]) => brief.items.filter((i) => i.tone === tone).length;
  const summary =
    [
      count("bad") && `${count("bad")} need${count("bad") === 1 ? "s" : ""} a look`,
      count("good") && `${count("good")} good news`,
      count("info") && `${count("info")} for context`,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing stood out yesterday.";

  return (
    <BriefFrame
      title={
        <>
          <SunriseIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          Morning brief · {formatDay(brief.date)}
        </>
      }
      summary={summary}
    >
      <p className="-mt-2 px-4 text-sm text-muted-foreground">
        Yesterday against last week ({formatRange(brief.week)}), all campaigns. Each campaign is one channel in one
        country, so these are within-country comparisons.
      </p>
      <div className="flex flex-col gap-3 px-4">
        <p className="text-[15px] leading-relaxed">{brief.headline}</p>
        {brief.items.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {brief.items.map((item) => (
              <Item key={item.id} item={item} search={search} />
            ))}
          </ul>
        )}
        {brief.more > 0 && <p className="text-xs text-muted-foreground">{brief.more} more not shown.</p>}
      </div>
    </BriefFrame>
  );
}

function Item({ item, search }: { item: BriefItem; search: string }) {
  const { Icon, className, label } = TONE[item.tone];
  const href = item.investigate && investigateHref(item.investigate, search);
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-label={label} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        <p className="text-sm text-muted-foreground">{item.detail}</p>
      </div>
      {href && (
        <Link href={href} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "shrink-0 text-muted-foreground")}>
          <ScanSearchIcon /> Investigate
        </Link>
      )}
    </li>
  );
}

function investigateHref(target: NonNullable<BriefItem["investigate"]>, search: string): string {
  const params = new URLSearchParams({ campaign: target.campaignId, from: target.from, to: target.to, run: "1" });
  if (search) params.set("back", search.replace(/^\?/, ""));
  return `/investigate?${params}`;
}
