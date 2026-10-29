"use client";

import { CheckIcon, LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@components/ui/button";
import { insightPath } from "@lib/insights";

/**
 * Copies the insight's link. It opens for anyone signed in to the team account;
 * the sign-in page brings a signed-out teammate back to it.
 */
export function CopyLinkButton({ id, iconOnly }: { id: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    const url = new URL(insightPath(id), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied", { description: "Teammates need to be signed in to open it." });
    } catch {
      toast.error("Couldn't copy the link", { description: url });
    }
  };

  const Icon = copied ? CheckIcon : LinkIcon;
  return iconOnly ? (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy link" title="Copy link">
      <Icon />
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={copy}>
      <Icon /> {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
