"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Copies text to the clipboard. `text` may be a loader (an export to fetch):
 * it goes in as a pending ClipboardItem so Safari still sees the click.
 */
export function CopyButton({ text, label, iconOnly }: { text: string | (() => Promise<string>); label: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      if (typeof text === "string") await navigator.clipboard.writeText(text);
      else {
        const blob = text().then((t) => new Blob([t], { type: "text/plain" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      }
      setCopied(true);
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  };

  const Icon = copied ? CheckIcon : CopyIcon;
  return iconOnly ? (
    <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={copied ? "Copied" : label} title={label}>
      <Icon />
    </Button>
  ) : (
    <Button variant="outline" size="xs" onClick={copy}>
      <Icon /> {copied ? "Copied" : label}
    </Button>
  );
}
