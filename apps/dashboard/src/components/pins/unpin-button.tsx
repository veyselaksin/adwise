"use client";

import { PinOffIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { unpin } from "@/app/pins/actions";
import { Button } from "@/components/ui/button";

export function UnpinButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      disabled={pending}
      aria-label={`Unpin ${title}`}
      title="Unpin from the overview"
      onClick={() =>
        start(async () => {
          const res = await unpin(id);
          if (res.error) toast.error(res.error);
        })
      }
    >
      <PinOffIcon />
    </Button>
  );
}
