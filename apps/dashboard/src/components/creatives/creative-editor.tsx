"use client";

import { AlertTriangleIcon, DownloadIcon, ExternalLinkIcon, ImageIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { generateImage } from "@app/creatives/actions";
import { Button, buttonVariants } from "@components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select";
import { Textarea } from "@components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { ASPECT_RATIO_LABELS, creativeImageSrc, creativePath, formatSeconds } from "@lib/creatives";
import { cn } from "@lib/utils";
import type { AspectRatio, Creative, CreativeConcept, CreativeSource, StudioConfig } from "@typings/creatives";
import { CreativePreview } from "./creative-preview";

export type EditorDraft = {
  concept: CreativeConcept;
  source?: CreativeSource;
  dataInformed: boolean;
  /** Set when this is a new variation of a saved creative. */
  parentId?: string;
  title?: string;
  copy?: Creative["copy"];
};

type Props = {
  draft: EditorDraft;
  image: StudioConfig["image"];
  limits: StudioConfig["limits"];
  /** Called with the request's creatives in order; at least one succeeded. */
  onGenerated?: (creatives: Creative[]) => void;
};

type Generation =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "done"; creatives: Creative[]; requested: number }
  /** The API answered with an error; nothing more will happen for this key. */
  | { status: "failed"; code: string; message: string }
  /** The connection broke: the request may still finish on the server under the same key. */
  | { status: "lost" };

/** Codes where trying again (as a new request) can work. */
const RETRYABLE = new Set(["IMAGE_RATE_LIMITED", "IMAGE_UNAVAILABLE", "IMAGE_TIMEOUT", "TOO_MANY_GENERATIONS", "GENERATION_IN_PROGRESS", "API_UNREACHABLE"]);

/**
 * Edit a concept's copy and image prompt, then generate 1–3 images. Each image
 * is a paid request; one click shares one idempotency key, a lost connection
 * re-sends that key (the server returns the images if they were made), and
 * only an explicit "new request" makes a new key.
 */
export function CreativeEditor({ draft, image, limits, onGenerated }: Props) {
  const { concept } = draft;
  const [title, setTitle] = useState(draft.title ?? concept.title);
  const [headline, setHeadline] = useState(draft.copy?.headline ?? concept.suggestedHeadline);
  const [primaryText, setPrimaryText] = useState(draft.copy?.primaryText ?? concept.suggestedPrimaryText);
  const [callToAction, setCallToAction] = useState(draft.copy?.callToAction ?? concept.suggestedCallToAction);
  const [prompt, setPrompt] = useState(concept.imagePrompt);
  const [ratio, setRatio] = useState<AspectRatio>(image.aspectRatios.includes(concept.aspectRatio) ? concept.aspectRatio : image.defaultAspectRatio);
  const [count, setCount] = useState(1);
  const [shown, setShown] = useState(0);
  const [generation, setGeneration] = useState<Generation>({ status: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const keyRef = useRef<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (generation.status !== "running") return;
    const timer = setInterval(() => setElapsed(Date.now() - generation.startedAt), 500);
    return () => clearInterval(timer);
  }, [generation]);

  const copy = { headline: headline.trim(), primaryText: primaryText.trim(), callToAction: callToAction.trim() };
  const problem =
    !copy.headline || !copy.primaryText || !copy.callToAction
      ? "Fill in the headline, primary text and call to action."
      : prompt.trim().length < 10
        ? "Describe the image in at least a few words."
        : prompt.length > limits.imagePrompt
          ? `Keep the image prompt under ${limits.imagePrompt} characters.`
          : null;
  const remaining = Math.max(0, image.dailyLimit - image.usedToday);
  const running = generation.status === "running";
  const counts = Array.from({ length: Math.min(image.countMax, 3) }, (_, i) => i + 1);
  const results = generation.status === "done" ? generation.creatives : [];
  const current = results[Math.min(shown, results.length - 1)] ?? null;
  const images = (n: number) => `${n} image${n === 1 ? "" : "s"}`;

  async function submit(sameKey: boolean) {
    if (busy.current || problem || !image.enabled) return;
    busy.current = true;
    if (!sameKey || !keyRef.current) keyRef.current = crypto.randomUUID();
    setElapsed(0);
    setGeneration({ status: "running", startedAt: Date.now() });
    try {
      const res = await generateImage({
        idempotencyKey: keyRef.current,
        count,
        concept: { ...concept, imagePrompt: prompt.trim(), aspectRatio: ratio, suggestedHeadline: copy.headline, suggestedPrimaryText: copy.primaryText, suggestedCallToAction: copy.callToAction },
        copy,
        imagePrompt: prompt.trim(),
        aspectRatio: ratio,
        title: title.trim() || concept.title,
        ...(draft.source && { source: draft.source }),
        ...(draft.parentId && { parentId: draft.parentId }),
      });
      if (res.ok) {
        const first = res.data.creatives.findIndex((c) => c.status === "succeeded");
        setShown(Math.max(0, first));
        setGeneration({ status: "done", creatives: res.data.creatives, requested: res.data.requested });
        onGenerated?.(res.data.creatives);
      } else {
        setGeneration({ status: "failed", code: res.code, message: res.error });
      }
    } catch {
      setGeneration({ status: "lost" });
    } finally {
      busy.current = false;
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{draft.parentId ? "New variation" : "Review and generate"}</CardTitle>
        <CardDescription>
          Edit anything before generating. The image prompt goes to {image.model.label} (via {image.provider}); your campaign data doesn&apos;t, unless you type it here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <Field id="cr-title" label="Title (for the library)">
            <Input id="cr-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={running} />
          </Field>
          <Field id="cr-headline" label="Headline" count={`${headline.length}/80`}>
            <Input id="cr-headline" value={headline} maxLength={80} onChange={(e) => setHeadline(e.target.value)} disabled={running} />
          </Field>
          <Field id="cr-primary" label="Primary text" count={`${primaryText.length}/500`}>
            <Textarea id="cr-primary" rows={3} value={primaryText} maxLength={500} onChange={(e) => setPrimaryText(e.target.value)} disabled={running} />
          </Field>
          <Field id="cr-cta" label="Call to action">
            <Input id="cr-cta" value={callToAction} maxLength={40} onChange={(e) => setCallToAction(e.target.value)} disabled={running} />
          </Field>
          <Field id="cr-prompt" label="Image prompt" count={`${prompt.length}/${limits.imagePrompt}`}>
            <Textarea id="cr-prompt" rows={5} value={prompt} maxLength={limits.imagePrompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} />
          </Field>
          <p className="-mt-1 text-xs text-muted-foreground">
            The server adds: &ldquo;No text, letters, words, logos or watermarks anywhere in the image.&rdquo; Copy stays editable here instead.
          </p>
          <Field id="cr-ratio" label="Aspect ratio">
            <Select items={image.aspectRatios.map((r) => ({ value: r, label: ASPECT_RATIO_LABELS[r] }))} value={ratio} onValueChange={(v) => v && setRatio(v as AspectRatio)} disabled={running}>
              <SelectTrigger id="cr-ratio" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {image.aspectRatios.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ASPECT_RATIO_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {counts.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label id="cr-count-label">Images</Label>
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
                aria-labelledby="cr-count-label"
                value={[String(count)]}
                onValueChange={(v: string[]) => v[0] && setCount(Number(v[0]))}
                disabled={running}
              >
                {counts.map((n) => (
                  <ToggleGroupItem key={n} value={String(n)} disabled={n > remaining} className="tabular-nums">
                    {n}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                Same prompt, separate generations: each image comes out different and is saved as its own creative.
              </p>
            </div>
          )}

          {!image.enabled ? (
            <SetupNote reason={image.disabledReason} />
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">
                  {count === 1 ? "Each click is a new paid image request." : `This click is ${count} paid image requests, one per image.`}
                </span>{" "}
                {image.costNote}
              </p>
              <p className="tabular-nums">
                Team limit today: {image.usedToday} of {image.dailyLimit} used.
              </p>
            </div>
          )}
          {problem && <p className="text-sm text-delta-bad">{problem}</p>}
          {remaining > 0 && remaining < count && <p className="text-sm text-delta-bad">Only {images(remaining)} left today. Pick fewer.</p>}
          <Button type="submit" disabled={running || !!problem || !image.enabled || remaining < count}>
            {running ? <Loader2Icon className="animate-spin" /> : <ImageIcon />}
            {running
              ? `Generating ${images(count)}…`
              : remaining === 0
                ? "Daily limit reached"
                : generation.status === "done"
                  ? `Generate ${count === 1 ? "another" : `${count} more`} (new paid request${count === 1 ? "" : "s"})`
                  : `Generate ${images(count)}`}
          </Button>
        </form>

        <div className="flex flex-col gap-3" aria-live="polite">
          <CreativePreview
            id={current?.id ?? null}
            hasImage={!!current?.image}
            aspectRatio={current?.aspectRatio ?? ratio}
            copy={copy.headline ? copy : { headline: "Headline", primaryText: "Primary text", callToAction: "CTA" }}
            alt={`Generated image for “${title}”`}
            placeholder={<Status generation={generation} current={current} elapsed={elapsed} model={image.model.label} count={count} />}
          />
          {results.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                {results.filter((c) => c.status === "succeeded").length} of {results.length} images generated. Pick one to preview; all are saved.
              </p>
              <div role="group" aria-label="Generated images" className="flex gap-2">
                {results.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setShown(i)}
                    aria-pressed={i === shown}
                    aria-label={`Image ${i + 1}${c.status === "failed" ? " (failed)" : ""}`}
                    className={cn(
                      "relative size-16 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i === shown && "ring-2 ring-primary",
                    )}
                  >
                    {c.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- private image through the dashboard's own route; no optimization wanted
                      <img src={creativeImageSrc(c.id)} alt="" className="size-full object-cover" />
                    ) : (
                      <AlertTriangleIcon className="mx-auto size-4 text-destructive" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {current && (
            <div className="flex flex-wrap gap-2">
              {current.image && (
                <a href={creativeImageSrc(current.id, true)} className={buttonVariants({ variant: "outline", size: "sm" })} download>
                  <DownloadIcon /> Download
                </a>
              )}
              <Link href={creativePath(current.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLinkIcon /> Open saved creative
              </Link>
            </div>
          )}
          {generation.status === "failed" && (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangleIcon className="size-4 text-destructive" aria-hidden="true" /> {count === 1 ? "The image wasn't generated" : "None of the images were generated"}
              </p>
              <p className="text-muted-foreground">{generation.message}</p>
              <p className="text-xs text-muted-foreground">The attempt is kept in the library as failed. Code: {generation.code}</p>
              {RETRYABLE.has(generation.code) && (
                <Button variant="outline" size="sm" className="w-fit" onClick={() => void submit(false)} disabled={running}>
                  <RefreshCwIcon /> Try again (new paid request)
                </Button>
              )}
            </div>
          )}
          {generation.status === "lost" && (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <p className="font-medium">The connection dropped before the result arrived.</p>
              <p className="text-muted-foreground">The images may still have been made. Checking again sends the same request id, so they can&apos;t be billed twice.</p>
              <Button variant="outline" size="sm" className="w-fit" onClick={() => void submit(true)}>
                <RefreshCwIcon /> Check again
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type StatusProps = { generation: Generation; current: Creative | null; elapsed: number; model: string; count: number };

function Status({ generation, current, elapsed, model, count }: StatusProps) {
  if (generation.status === "running") {
    return (
      <span className="flex flex-col items-center gap-2" role="status">
        <Loader2Icon className="size-6 animate-spin" aria-hidden="true" />
        <span className="font-medium text-foreground">
          Generating {count === 1 ? "" : `${count} images `}with {model}…
        </span>
        <span className="tabular-nums">
          {formatSeconds(elapsed)} · usually 30–45 s{count > 1 ? ", side by side" : ""}. You can leave: {count === 1 ? "the image is" : "they're"} saved to your library either
          way.
        </span>
      </span>
    );
  }
  if (current?.status === "failed") {
    return (
      <span className="flex flex-col items-center gap-2 px-4">
        <AlertTriangleIcon className="size-6 text-destructive" aria-hidden="true" />
        <span className="font-medium text-foreground">This image failed</span>
        <span>{current.error?.message}</span>
      </span>
    );
  }
  if (generation.status === "failed" || generation.status === "lost") {
    return (
      <span className="flex flex-col items-center gap-2">
        <AlertTriangleIcon className="size-6" aria-hidden="true" /> No image
      </span>
    );
  }
  return (
    <span className="flex flex-col items-center gap-2">
      <ImageIcon className="size-6" aria-hidden="true" /> The image appears here after you generate it.
    </span>
  );
}

function Field({ id, label, count, children }: { id: string; label: string; count?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {count && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
      </div>
      {children}
    </div>
  );
}

export function SetupNote({ reason, className }: { reason: string | null; className?: string }) {
  return (
    <div role="status" className={cn("flex gap-2 rounded-lg border border-provisional/40 bg-provisional/5 px-3 py-2.5 text-sm", className)}>
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-provisional" aria-hidden="true" />
      <div>
        <p className="font-medium">Image generation isn&apos;t set up</p>
        <p className="text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}
