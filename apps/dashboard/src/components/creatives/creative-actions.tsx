"use client";

import { DownloadIcon, Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeCreative, saveCreativeCopy } from "@app/creatives/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { Button, buttonVariants } from "@components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@components/ui/dialog";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Textarea } from "@components/ui/textarea";
import { creativeImageSrc } from "@lib/creatives";
import type { Creative } from "@typings/creatives";

/** Download, edit the title and copy (no new image), and delete with confirmation. */
export function CreativeActions({ creative }: { creative: Creative }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {creative.image && (
        <a href={creativeImageSrc(creative.id, true)} download className={buttonVariants({ variant: "outline", size: "sm" })}>
          <DownloadIcon /> Download image
        </a>
      )}
      <EditCopy creative={creative} />
      <Delete creative={creative} />
    </div>
  );
}

function EditCopy({ creative }: { creative: Creative }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(creative.title);
  const [copy, setCopy] = useState(creative.copy);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !copy.headline.trim() || !copy.primaryText.trim() || !copy.callToAction.trim()) {
      return setError("Every field needs some text.");
    }
    start(async () => {
      const res = await saveCreativeCopy(creative.id, { title, copy });
      if (!res.ok) return setError(res.error);
      toast.success("Copy saved");
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTitle(creative.title);
          setCopy(creative.copy);
          setError(null);
        }
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilIcon /> Edit copy
      </Button>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Edit title and copy</DialogTitle>
            <DialogDescription>Saves the text only; the image stays as generated. For a new image, use “New variation”.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="edit-title">Title</Label>
          <Input id="edit-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          <Label htmlFor="edit-headline">Headline</Label>
          <Input id="edit-headline" value={copy.headline} maxLength={80} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} />
          <Label htmlFor="edit-primary">Primary text</Label>
          <Textarea id="edit-primary" rows={3} value={copy.primaryText} maxLength={500} onChange={(e) => setCopy({ ...copy, primaryText: e.target.value })} />
          <Label htmlFor="edit-cta">Call to action</Label>
          <Input id="edit-cta" value={copy.callToAction} maxLength={40} onChange={(e) => setCopy({ ...copy, callToAction: e.target.value })} />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Delete({ creative }: { creative: Creative }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await removeCreative(creative.id);
      if (!res.ok) {
        toast.error("Couldn't delete the creative", { description: res.error });
        return;
      }
      setOpen(false);
      toast.success("Creative deleted");
      router.push("/creatives/library");
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={creative.status === "generating"} className="text-muted-foreground hover:text-destructive">
        <Trash2Icon /> Delete
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this creative?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{creative.title}&rdquo; and its image file will be removed for good. Download the image first if you need it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove} disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />} Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
