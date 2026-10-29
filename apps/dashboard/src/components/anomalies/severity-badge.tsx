import { Badge } from "@components/ui/badge";
import { SEVERITY_LABELS } from "@constants/anomalies";
import type { Severity } from "@typings/anomalies";
import { cn } from "@lib/utils";

const VARIANT = { high: "destructive", medium: "outline", low: "secondary" } as const;

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <Badge variant={VARIANT[severity]} className={cn(severity === "medium" && "border-delta-bad/40 text-delta-bad", className)}>
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}
