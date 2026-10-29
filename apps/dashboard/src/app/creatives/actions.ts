"use server";

import { refresh } from "next/cache";
import {
  ApiError,
  deleteCreative,
  generateConcepts,
  generateCreative,
  getCreativeContext,
  suggestBrief,
  updateCreative,
} from "@lib/api";
import type {
  BriefSuggestRequest,
  BriefSuggestResult,
  ConceptsRequest,
  ConceptsResult,
  Creative,
  CreativeActionResult,
  CreativeContext,
  CreativeCopy,
  CreativeSource,
  GenerateRequest,
  GenerateResult,
} from "@typings/creatives";

/** Runs an API call; API errors come back as a code and text to show, not as a thrown error. */
async function attempt<T>(run: () => Promise<T>, after?: () => void): Promise<CreativeActionResult<T>> {
  try {
    const data = await run();
    after?.();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, error: err.message };
    throw err;
  }
}

export const loadContext = async (source: CreativeSource): Promise<CreativeActionResult<CreativeContext>> =>
  attempt(() => getCreativeContext(source));

export const writeConcepts = async (request: ConceptsRequest): Promise<CreativeActionResult<ConceptsResult>> =>
  attempt(() => generateConcepts(request));

export const suggestBriefFields = async (request: BriefSuggestRequest): Promise<CreativeActionResult<BriefSuggestResult>> =>
  attempt(() => suggestBrief(request));

/** 1–3 paid images. The browser keeps the idempotency key, so a resend returns the same creatives. */
export const generateImage = async (request: GenerateRequest): Promise<CreativeActionResult<GenerateResult>> =>
  attempt(() => generateCreative(request));

export const saveCreativeCopy = async (id: string, changes: { title?: string; copy?: Partial<CreativeCopy> }): Promise<CreativeActionResult<Creative>> =>
  attempt(() => updateCreative(id, changes), refresh);

export const removeCreative = async (id: string): Promise<CreativeActionResult<Creative>> => attempt(() => deleteCreative(id), refresh);
