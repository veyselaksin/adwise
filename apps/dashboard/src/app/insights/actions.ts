"use server";

import { refresh } from "next/cache";
import { ApiError, createInsight, deleteInsight, previewInsight, renameInsight } from "@lib/api";
import type { Insight, InsightActionResult, InsightDraft } from "@typings/insights";

/** Runs an API call; API errors come back as a code and text to show, not as a thrown error. */
async function attempt<T>(run: () => Promise<T>, after?: () => void): Promise<InsightActionResult<T>> {
  try {
    const data = await run();
    after?.();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, error: err.message };
    throw err;
  }
}

/** What saving the answer would store, for the review dialog. Writes nothing. */
export const previewAnswer = async (token: string): Promise<InsightActionResult<InsightDraft>> =>
  attempt(() => previewInsight(token));

export const saveInsight = async (token: string, title: string): Promise<InsightActionResult<Insight>> =>
  attempt(() => createInsight(token, title));

export const renameSavedInsight = async (id: string, title: string): Promise<InsightActionResult<Insight>> =>
  attempt(() => renameInsight(id, title), refresh);

export const deleteSavedInsight = async (id: string): Promise<InsightActionResult<Insight>> =>
  attempt(() => deleteInsight(id), refresh);
