"use server";

import { refresh } from "next/cache";
import { ApiError, createRule, deleteRule, updateRule } from "@/lib/api";
import type { Rule } from "@/lib/types";

export type RuleResult = { error?: string; rule?: Rule };

/** Runs a change, then refreshes the page so the list shows it. API errors come back as text; redirects pass through. */
async function change(run: () => Promise<Rule>): Promise<RuleResult> {
  try {
    const rule = await run();
    refresh();
    return { rule };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export async function addRule(_prev: RuleResult, form: FormData): Promise<RuleResult> {
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { error: "Write the rule first." };
  return change(() => createRule(text));
}

export const editRule = async (id: string, text: string) => change(() => updateRule(id, { text }));

export const switchRule = async (id: string, enabled: boolean) => change(() => updateRule(id, { enabled }));

export const removeRule = async (id: string) => change(() => deleteRule(id));
