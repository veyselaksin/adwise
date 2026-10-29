"use client";

import { CheckIcon, Loader2Icon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { addRule, editRule, removeRule, switchRule } from "@app/rules/actions";
import { Button } from "@components/ui/button";
import { Switch } from "@components/ui/switch";
import { Textarea } from "@components/ui/textarea";
import type { Rule, RuleResult } from "@typings/rules";
import { cn } from "@lib/utils";

const updated = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function RuleList({ rules }: { rules: Rule[] }) {
  if (rules.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No rules yet. The agent follows the glossary and the team notes.
      </p>
    );
  }
  const active = rules.filter((r) => r.enabled).length;
  return (
    <section className="flex flex-col gap-2" aria-label="Rules">
      <p className="text-xs text-muted-foreground">
        {active} of {rules.length} rule{rules.length === 1 ? "" : "s"} on
      </p>
      <ol className="flex flex-col gap-2">
        {rules.map((rule) => (
          <RuleItem key={rule.id} rule={rule} />
        ))}
      </ol>
    </section>
  );
}

/** Shows a failed change as a toast; returns whether it worked. */
const report = (result: RuleResult) => {
  if (result.error) toast.error(result.error);
  return !result.error;
};

function RuleItem({ rule }: { rule: Rule }) {
  const [enabled, setEnabled] = useOptimistic(rule.enabled);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setEnabled(next);
      report(await switchRule(rule.id, next));
    });

  const remove = () =>
    startTransition(async () => {
      if (!report(await removeRule(rule.id))) return;
      toast("Rule deleted", {
        action: {
          label: "Undo",
          onClick: async () => {
            const form = new FormData();
            form.set("text", rule.text);
            report(await addRule({}, form));
          },
        },
      });
    });

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card p-3 transition-opacity motion-safe:animate-in motion-safe:fade-in",
        !enabled && "opacity-60",
      )}
    >
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={pending || editing}
        aria-label={enabled ? "Switch rule off" : "Switch rule on"}
        className="mt-0.5"
      />
      {editing ? (
        <RuleEditor rule={rule} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-sm break-words whitespace-pre-wrap">{rule.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {enabled ? "On" : "Off"} · updated {updated.format(new Date(rule.updatedAt))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
            <Button variant="ghost" size="icon-sm" aria-label="Edit rule" disabled={pending} onClick={() => setEditing(true)}>
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Delete rule" disabled={pending} onClick={remove}>
              <Trash2Icon />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

function RuleEditor({ rule, onDone }: { rule: Rule; onDone: () => void }) {
  const [text, setText] = useState(rule.text);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      if (text.trim() === rule.text) return onDone();
      if (report(await editRule(rule.id, text))) onDone();
    });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={2}
        autoFocus
        aria-label="Rule text"
        className="resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") onDone();
        }}
      />
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <XIcon /> Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={pending || !text.trim()}>
          {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Save
        </Button>
      </div>
    </div>
  );
}
