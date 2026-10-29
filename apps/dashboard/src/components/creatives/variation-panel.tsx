"use client";

import { CopyPlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@components/ui/button";
import { creativePath } from "@lib/creatives";
import type { Creative, StudioConfig } from "@typings/creatives";
import { CreativeEditor } from "./creative-editor";

/**
 * Opens the editor on a saved creative's concept, prompt and copy to make a new
 * variation. Reopening a creative never generates anything; only the button in
 * the editor does, and it says that it's a new paid request.
 */
export function VariationPanel({ creative, config }: { creative: Creative; config: StudioConfig }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!config.image.enabled} title={config.image.disabledReason ?? undefined}>
        <CopyPlusIcon /> New variation
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => setOpen(false)}>
        <XIcon /> Close variation editor
      </Button>
      <CreativeEditor
        draft={{
          concept: { ...creative.concept, imagePrompt: creative.imagePrompt, aspectRatio: creative.aspectRatio },
          ...(creative.source && { source: creative.source }),
          dataInformed: creative.dataInformed,
          parentId: creative.id,
          title: `${creative.title} (variation)`.slice(0, 80),
          copy: creative.copy,
        }}
        image={config.image}
        limits={config.limits}
        onGenerated={(created) => router.push(creativePath((created.find((c) => c.status === "succeeded") ?? created[0]!).id))}
      />
    </div>
  );
}
