"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, ChatMessage } from "@/lib/types";

export type AgentStep = { id: string; label: string; status: "running" | "ok" | "failed"; summary?: string };

export type AgentTurn = {
  id: string;
  question: string;
  steps: AgentStep[];
  notes: string[];
  /** Text still being written; it becomes the answer, or a note if a lookup follows. */
  draft: string;
  answer?: string;
  error?: { code: string; message: string };
  usage?: { steps: number; tokens: number };
  status: "streaming" | "done" | "stopped";
};

const STORAGE_KEY = "adwise.agent.turns";

/** Restores the last conversation in this browser; a convenience only, so failures are ignored. */
function readStored(): AgentTurn[] {
  try {
    const turns = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as AgentTurn[];
    // A reload mid-answer leaves a turn that will never finish.
    return turns.map((t) => ({ ...t, draft: t.draft ?? "", ...(t.status === "streaming" && { status: "stopped" }) }));
  } catch {
    return [];
  }
}

/** The conversation as the API expects it: each question, and each answer that arrived. */
const toHistory = (turns: AgentTurn[]): ChatMessage[] =>
  turns.flatMap((t) => [
    { role: "user" as const, text: t.question },
    ...(t.answer ? [{ role: "assistant" as const, text: t.answer }] : []),
  ]);

function applyEvent(turn: AgentTurn, event: AgentEvent): AgentTurn {
  switch (event.type) {
    case "tool_call":
      return { ...turn, steps: [...turn.steps, { id: event.id, label: event.label, status: "running" }] };
    case "tool_result":
      return {
        ...turn,
        steps: turn.steps.map((s) =>
          s.id === event.id ? { ...s, status: event.ok ? "ok" : "failed", summary: event.summary } : s,
        ),
      };
    case "text_delta":
      return { ...turn, draft: turn.draft + event.text };
    case "note":
      return { ...turn, notes: [...turn.notes, event.text], draft: "" };
    case "answer":
      return { ...turn, answer: event.text, draft: "" };
    case "error":
      return { ...turn, error: { code: event.code, message: event.message } };
    case "done":
      return {
        ...turn,
        status: "done",
        usage: { steps: event.steps, tokens: event.usage.inputTokens + event.usage.outputTokens },
      };
  }
}

export function useAgentChat() {
  // The panel only mounts in the browser, after the user opens it, so storage is safe to read here.
  const [turns, setTurns] = useState<AgentTurn[]>(readStored);
  const abortRef = useRef<AbortController | null>(null);
  const busy = turns.at(-1)?.status === "streaming";

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      // Storage full or blocked: the chat still works, it just won't survive a reload.
    }
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Streams an answer to `question`, with `history` as the conversation before it. */
  const send = useCallback(
    async (history: AgentTurn[], question: string) => {
      const text = question.trim();
      if (!text) return;

      const id = crypto.randomUUID();
      const messages = [...toHistory(history), { role: "user" as const, text }];
      const update = (fn: (t: AgentTurn) => AgentTurn) =>
        setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
      const fail = (code: string, message: string) =>
        update((t) => ({ ...t, status: "done", error: { code, message } }));
      setTurns((all) => [...all, { id, question: text, steps: [], notes: [], draft: "", status: "streaming" }]);

      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const res = await fetch("/agent/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages }),
          signal: abort.signal,
        });
        // Without a session, the proxy redirects to the sign-in page.
        if (res.redirected || res.status === 401) return fail("UNAUTHORIZED", "Your session ended. Sign in again.");
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { message?: string; error?: { code?: string } } | null;
          return fail(body?.error?.code ?? "BAD_RESPONSE", body?.message ?? `The agent didn't respond (${res.status}).`);
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
            const event = JSON.parse(line) as AgentEvent;
            finished ||= event.type === "done";
            update((t) => applyEvent(t, event));
          }
        }
        if (!finished) fail("CONNECTION_LOST", "The connection dropped before the answer finished. Try again.");
      } catch {
        if (abort.signal.aborted) update((t) => ({ ...t, status: "stopped" }));
        else fail("NETWORK_ERROR", "Couldn't reach the agent. Check your connection and try again.");
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
      }
    },
    [],
  );

  const ask = useCallback((question: string) => (busy ? undefined : send(turns, question)), [busy, send, turns]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, []);

  /** Asks the last question again, replacing its failed or stopped attempt. */
  const retry = useCallback(() => {
    const last = turns.at(-1);
    if (!last || busy) return;
    setTurns((all) => all.slice(0, -1));
    void send(turns.slice(0, -1), last.question);
  }, [busy, send, turns]);

  return { turns, busy, ask, stop, reset, retry };
}
