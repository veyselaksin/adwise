"use client";

import { Loader2Icon, RotateCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@components/ui/button";

/** Re-renders the page's server components, fetching their data again. */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />} {label}
    </Button>
  );
}
