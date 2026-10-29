"use client";

import { CheckIcon, PinIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { pinQuery } from "@/app/pins/actions";
import { Button } from "@/components/ui/button";
import type { AgentStep } from "@/types/agent.type";

/**
 * Pins the answer's last metrics lookup to the overview. The tile keeps the
 * agent's query, not its numbers, so it re-runs (without the model) and stays current.
 */
export function PinButton({ question, steps }: { question: string; steps: AgentStep[] }) {
  const [pinned, setPinned] = useState(false);
  const [pending, start] = useTransition();
  const lookup = steps.findLast((s) => s.tool === "query_metrics" && s.status === "ok" && s.args);
  if (!lookup) return null;

  const pin = () =>
    start(async () => {
      const res = await pinQuery(question, lookup.args!);
      if (res.error) toast.error(res.error);
      else {
        setPinned(true);
        toast.success("Pinned to the overview");
      }
    });

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={pin}
      disabled={pending || pinned}
      aria-label={pinned ? "Pinned" : "Pin to the overview"}
      title={pinned ? "Pinned to the overview" : `Pin to the overview: ${lookup.label}`}
    >
      {pinned ? <CheckIcon /> : <PinIcon />}
    </Button>
  );
}
