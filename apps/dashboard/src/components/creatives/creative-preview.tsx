import { ImageOffIcon, InfoIcon } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { creativeImageSrc, cssRatio } from "@lib/creatives";
import { cn } from "@lib/utils";
import type { AspectRatio, CreativeCopy } from "@typings/creatives";
import { CtaPreview } from "./cta-preview";

type Props = {
  /** The saved creative whose image to show; null shows `placeholder`. */
  id: string | null;
  hasImage: boolean;
  aspectRatio: AspectRatio;
  copy: CreativeCopy;
  alt: string;
  placeholder?: ReactNode;
  className?: string;
};

/**
 * The image with the ad copy laid out the way a feed ad reads. The copy is
 * application data next to the image, never drawn into it, and the note says so.
 */
export function CreativePreview({ id, hasImage, aspectRatio, copy, alt, placeholder, className }: Props) {
  return (
    <figure className={cn("flex flex-col overflow-hidden rounded-xl border bg-card", className)}>
      <div className="relative w-full bg-muted" style={{ aspectRatio: cssRatio(aspectRatio) }}>
        {id && hasImage ? (
          // The image is private and served through the dashboard's own route, so it isn't optimized or cached.
          <Image src={creativeImageSrc(id)} alt={alt} fill unoptimized sizes="(min-width: 1024px) 40vw, 100vw" className="object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {placeholder ?? (
              <span className="flex flex-col items-center gap-2">
                <ImageOffIcon className="size-6" aria-hidden="true" /> No image
              </span>
            )}
          </div>
        )}
      </div>
      <figcaption className="flex flex-col gap-1 border-t px-3 py-2.5">
        <p className="font-semibold leading-snug">{copy.headline}</p>
        <p className="text-sm text-muted-foreground">{copy.primaryText}</p>
        <CtaPreview label={copy.callToAction} />
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground">
          <InfoIcon className="mt-px size-3 shrink-0" aria-hidden="true" />
          Copy is shown beside the image, not rendered into it. Any lettering inside the image was drawn by the model and isn&apos;t checked.
        </p>
      </figcaption>
    </figure>
  );
}
