"use client";

import { createContext, type ReactNode, use, useState } from "react";
import { cn } from "@lib/utils";
import { AgentPanel } from "./agent-panel";

type AgentState = { open: boolean; setOpen: (open: boolean) => void };

const AgentContext = createContext<AgentState | null>(null);

export function useAgent(): AgentState {
  const ctx = use(AgentContext);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}

/**
 * Docks the agent beside the dashboard. On wide screens the page makes room
 * for it; on narrow ones it covers the page. Once opened, the panel stays
 * mounted (just hidden), so closing it doesn't cut off an answer.
 */
export function AgentProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [mounted, setMounted] = useState(false);
  const setOpen = (next: boolean) => {
    if (next) setMounted(true);
    setOpenState(next);
  };

  return (
    <AgentContext value={{ open, setOpen }}>
      <div className={cn("flex flex-1 flex-col transition-[padding] duration-200", open && "lg:pr-[26rem]")}>
        {children}
      </div>
      {mounted && <AgentPanel open={open} onClose={() => setOpen(false)} />}
    </AgentContext>
  );
}
