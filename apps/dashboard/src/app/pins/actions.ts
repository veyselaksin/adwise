"use server";

import { refresh } from "next/cache";
import { ApiError, createPin, deletePin } from "@lib/api";
import type { PinActionResult } from "@typings/pins";

/** Runs a change, then refreshes the page so the overview shows it. API errors come back as text. */
async function change(run: () => Promise<unknown>): Promise<PinActionResult> {
  try {
    await run();
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

/** Pins an agent `query_metrics` call; the API validates it like a tool call. */
export const pinQuery = async (title: string, query: Record<string, unknown>) => change(() => createPin(title, query));

export const unpin = async (id: string) => change(() => deletePin(id));
