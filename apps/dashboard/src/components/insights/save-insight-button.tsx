"use client";

import {
  AlertCircleIcon,
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { previewAnswer, saveInsight } from "@app/insights/actions";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@components/ui/dialog";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { formatRange } from "@lib/format";
import { channelLabel, countryLabel, insightPath } from "@lib/insights";
import type { InsightDraft } from "@typings/insights";

const TITLE_MAX = 120;

/**
 * Saves a finished answer as an insight. The review step shows what the server
 * will keep, read from the answer's signed snapshot: the question, the lookups
 * behind it and the scope they covered. Only the title can be edited.
 */
export function SaveInsightButton({ snapshot }: { snapshot?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InsightDraft | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  // Answers from before insights existed have no snapshot to save.
  if (!snapshot) return null;

  const openReview = () => {
    if (savedId) return router.push(insightPath(savedId));
    setOpen(true);
    setError(null);
    if (draft) return;
    startLoading(async () => {
      const res = await previewAnswer(snapshot);
      if (!res.ok) return setError(res.error);
      setDraft(res.data);
      setTitle(res.data.title);
    });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Give the insight a title.");
    startSaving(async () => {
      const res = await saveInsight(snapshot, title);
      if (!res.ok) {
        if (res.code === "INSIGHT_EXISTS") {
          setOpen(false);
          toast.info("Already saved", { description: "This answer is in Insights.", action: { label: "Open library", onClick: () => router.push("/insights") } });
          return;
        }
        return setError(res.error);
      }
      setSavedId(res.data.id);
      setOpen(false);
      toast.success("Insight saved", {
        description: res.data.title,
        action: { label: "Open", onClick: () => router.push(insightPath(res.data.id)) },
      });
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={openReview}
        title={
          savedId
            ? "Saved: open the report"
            : "Saves this answer and the data behind it as a report in Insights, with a link to share"
        }
      >
        {savedId ? <BookmarkCheckIcon /> : <BookmarkPlusIcon />} {savedId ? "Open insight" : "Save insight"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
          {/* min-w-0: the dialog is a grid, and its item would otherwise grow to its longest line. */}
          <form onSubmit={save} className="flex min-w-0 flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Save as insight</DialogTitle>
              <DialogDescription>
                Keeps this answer and the data behind it as a report your team can open by link. It&apos;s a
                snapshot: opening it later won&apos;t re-run anything.
              </DialogDescription>
            </DialogHeader>

            {loading && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-busy="true">
                <Loader2Icon className="size-4 animate-spin" /> Checking the answer…
              </div>
            )}

            {draft && <Review draft={draft} title={title} onTitle={setTitle} />}

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!draft || saving}>
                {saving && <Loader2Icon className="animate-spin" />} Save insight
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Review({ draft, title, onTitle }: { draft: InsightDraft; title: string; onTitle: (t: string) => void }) {
  const { scope, snapshot, caveats } = draft;
  const filters = [...scope.channels.map(channelLabel), ...scope.countries.map(countryLabel), ...scope.campaigns.map((c) => c.name)];
  const lookups = snapshot.evidence.length;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="insight-title">Title</Label>
        <Input
          id="insight-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => onTitle(e.target.value)}
          aria-describedby="insight-title-hint"
          autoFocus
        />
        <p id="insight-title-hint" className="text-xs text-muted-foreground">
          How it shows in the Insights library. You can rename it later.
        </p>
      </div>

      <section aria-labelledby="insight-answer" className="flex flex-col gap-2">
        <SectionHeading id="insight-answer" badge="AI-generated">
          Question and answer
        </SectionHeading>
        <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
          <p className="font-medium break-words">{snapshot.question}</p>
          <p className="line-clamp-3 break-words text-muted-foreground">{draft.summary}</p>
          <p className="text-xs text-muted-foreground">Answered by {snapshot.model.label}</p>
        </div>
      </section>

      <section aria-labelledby="insight-evidence" className="flex flex-col gap-2">
        <SectionHeading id="insight-evidence" badge="Verified data">
          Evidence kept
        </SectionHeading>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline" className="tabular-nums">
            {scope.period ? formatRange(scope.period) : "No period"}
          </Badge>
          {filters.length > 0
            ? filters.map((f) => (
                <Badge key={f} variant="outline">
                  {f}
                </Badge>
              ))
            : <Badge variant="outline">All channels and countries</Badge>}
        </div>
        {lookups === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            The agent answered without looking anything up, so the report will have no data behind it.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {snapshot.evidence.map((e) => (
              <li key={e.id} className="flex items-start gap-2 px-3 py-2">
                {e.ok ? (
                  <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Succeeded" />
                ) : (
                  <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="Failed" />
                )}
                <div className="min-w-0">
                  <p className="text-xs break-words">{e.label}</p>
                  <p className={e.ok ? "text-[0.7rem] text-muted-foreground tabular-nums" : "text-[0.7rem] text-destructive"}>
                    {e.ok ? e.summary : `Failed: ${e.summary}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {caveats.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {caveats.length} limitation{caveats.length === 1 ? "" : "s"} in the data will be shown with the report.
          </p>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ id, badge, children }: { id: string; badge: string; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      {children}
      <Badge variant="secondary" className="font-normal">
        {badge}
      </Badge>
    </h3>
  );
}
