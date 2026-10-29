"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InvestigationEvent, InvestigationRequest, InvestigationStage, InvestigationState } from "@/types/investigation.type";

/** Shown before the server reports them, so the whole path is visible from the start. */
const STAGES: InvestigationStage[] = [
  { key: "validate", label: "Checking campaign and dates", status: "pending" },
  { key: "current", label: "Loading the selected period", status: "pending" },
  { key: "previous", label: "Loading the previous period", status: "pending" },
  { key: "breakdown", label: "Comparing ad sets, ads and days", status: "pending" },
  { key: "releases", label: "Matching app releases", status: "pending" },
  { key: "interpret", label: "Interpreting the evidence", status: "pending" },
];

function applyEvent(state: InvestigationState, event: InvestigationEvent): InvestigationState {
  switch (event.type) {
    case "stage":
      return {
        ...state,
        stages: state.stages.map((s) => (s.key === event.key ? { ...s, label: event.label, status: event.status } : s)),
      };
    case "facts":
      return { ...state, facts: event.facts };
    case "interpretation":
      return { ...state, interpretation: event.interpretation };
    case "error":
      return { ...state, error: { code: event.code, message: event.message } };
    case "done":
      return { ...state, status: "done", model: event.model };
  }
}

/** Runs investigations through the dashboard's `/investigate/run` proxy, one at a time. */
export function useInvestigation() {
  const [state, setState] = useState<InvestigationState>({ status: "idle", stages: STAGES });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (request: InvestigationRequest) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const update = (fn: (s: InvestigationState) => InvestigationState) => {
      if (abortRef.current === abort) setState(fn);
    };
    const fail = (code: string, message: string) => update((s) => ({ ...s, status: "done", error: { code, message } }));
    setState({ status: "running", request, stages: STAGES.map((s) => ({ ...s })) });

    try {
      const res = await fetch("/investigate/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      if (res.redirected || res.status === 401) return fail("UNAUTHORIZED", "Your session ended. Sign in again.");
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: { code?: string } } | null;
        return fail(body?.error?.code ?? "BAD_RESPONSE", body?.message ?? `The investigation didn't start (${res.status}).`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          let event: InvestigationEvent;
          try {
            event = JSON.parse(line) as InvestigationEvent;
          } catch {
            continue;
          }
          finished ||= event.type === "done";
          update((s) => applyEvent(s, event));
        }
      }
      if (!finished) fail("CONNECTION_LOST", "The connection dropped before the investigation finished. Try again.");
    } catch {
      if (abort.signal.aborted) update((s) => ({ ...s, status: "stopped" }));
      else fail("NETWORK_ERROR", "Couldn't reach the server. Check your connection and try again.");
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { state, start, stop };
}
