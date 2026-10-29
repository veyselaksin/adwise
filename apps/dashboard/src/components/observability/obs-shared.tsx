import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, Loader2Icon, MinusCircleIcon, TimerOffIcon, XCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { RUN_STATUS_LABELS } from "@constants/observability";
import { cn } from "@lib/utils";
import type { RunStatus } from "@typings/observability";
import { RetryButton } from "./retry-button";

const STATUS_STYLE: Record<RunStatus, { icon: typeof CheckCircle2Icon; className: string }> = {
  success: { icon: CheckCircle2Icon, className: "border-delta-good/40 text-delta-good" },
  failure: { icon: XCircleIcon, className: "border-delta-bad/40 text-delta-bad" },
  timeout: { icon: TimerOffIcon, className: "border-delta-bad/40 text-delta-bad" },
  interrupted: { icon: AlertTriangleIcon, className: "border-provisional/50 text-provisional" },
  cancelled: { icon: MinusCircleIcon, className: "text-muted-foreground" },
  running: { icon: Loader2Icon, className: "text-muted-foreground" },
};

/** A run's outcome: icon + word, so it never relies on color alone. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cn("gap-1", className)}>
      <Icon className={cn("size-3", status === "running" && "animate-spin")} aria-hidden />
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SpanStatusBadge({ status }: { status: "ok" | "error" | "cancelled" }) {
  if (status === "ok") return <span className="text-xs text-delta-good">OK</span>;
  if (status === "cancelled") return <span className="text-xs text-muted-foreground">Cancelled</span>;
  return <span className="text-xs font-medium text-delta-bad">Error</span>;
}

/** An explanatory card for empty, failed or not-yet-populated states, with an optional retry. */
export function StateCard({ title, body, retry, children }: { title: string; body: ReactNode; retry?: boolean; children?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleDashedIcon className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      {(retry || children) && (
        <CardContent className="flex flex-wrap items-center gap-2">
          {children}
          {retry && <RetryButton />}
        </CardContent>
      )}
    </Card>
  );
}

/** A labelled figure; `muted` dims values that are unavailable rather than measured. */
export function Stat({ label, value, hint, muted, className }: { label: string; value: ReactNode; hint?: ReactNode; muted?: boolean; className?: string }) {
  return (
    <Card className={cn("gap-1 px-4 py-3", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", muted && "text-base font-medium text-muted-foreground")}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
