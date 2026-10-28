"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useActionState, useRef } from "react";
import { addRule, type RuleResult } from "@/app/rules/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const PLACEHOLDER = "e.g. When a question is about Brazil, also give money in BRL at 5.0 BRL per USD.";

/** 500 matches the server's limit; it answers RULE_TOO_LONG past it. */
const MAX_CHARS = 500;

export function RuleForm() {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<RuleResult, FormData>(async (prev, data) => {
    const result = await addRule(prev, data);
    if (result.rule) form.current?.reset();
    return result;
  }, {});

  return (
    <form ref={form} action={action} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <label htmlFor="rule-text" className="text-sm font-medium">
        New rule
      </label>
      <Textarea
        id="rule-text"
        name="text"
        required
        maxLength={MAX_CHARS}
        rows={2}
        placeholder={PLACEHOLDER}
        className="resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit();
        }}
      />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">One instruction, in your own words. ⌘/Ctrl + Enter adds it.</p>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Add rule
        </Button>
      </div>
    </form>
  );
}
