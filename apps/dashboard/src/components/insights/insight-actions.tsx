"use client";

import { Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteSavedInsight, renameSavedInsight } from "@app/insights/actions";
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
import { Button } from "@components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@components/ui/dialog";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { CopyLinkButton } from "./copy-link-button";

const TITLE_MAX = 120;

type Props = {
  insight: { id: string; title: string; mine: boolean };
  /** Where to go after deleting; the library stays put, a report page leaves. */
  afterDelete?: string;
  compact?: boolean;
};

/** Copy link for everyone; rename and delete only for the account that saved it (the API checks too). */
export function InsightActions({ insight, afterDelete, compact }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <CopyLinkButton id={insight.id} iconOnly={compact} />
      {insight.mine && (
        <>
          <RenameButton id={insight.id} title={insight.title} compact={compact} />
          <DeleteButton id={insight.id} title={insight.title} afterDelete={afterDelete} compact={compact} />
        </>
      )}
    </div>
  );
}

function RenameButton({ id, title, compact }: { id: string; title: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setError("Give the insight a title.");
    start(async () => {
      const res = await renameSavedInsight(id, value);
      if (!res.ok) return setError(res.error);
      toast.success("Insight renamed");
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValue(title);
          setError(null);
        }
      }}
    >
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setOpen(true)}
        aria-label="Rename"
        title="Rename"
      >
        <PencilIcon /> {!compact && "Rename"}
      </Button>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename insight</DialogTitle>
            <DialogDescription>Only the title changes. The answer and its evidence stay as saved.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`rename-${id}`}>Title</Label>
            <Input
              id={`rename-${id}`}
              value={value}
              maxLength={TITLE_MAX}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `rename-${id}-error` : undefined}
              autoFocus
            />
            {error && (
              <p id={`rename-${id}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />} Save title
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ id, title, afterDelete, compact }: { id: string; title: string; afterDelete?: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      const res = await deleteSavedInsight(id);
      if (!res.ok) {
        toast.error("Couldn't delete the insight", { description: res.error });
        return;
      }
      setOpen(false);
      toast.success("Insight deleted");
      if (afterDelete) router.push(afterDelete);
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setOpen(true)}
        aria-label="Delete"
        title="Delete"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2Icon /> {!compact && "Delete"}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this insight?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{title}&rdquo; and its evidence will be removed for everyone, and links to it will stop working.
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
