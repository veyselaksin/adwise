"use client";

import { useEffect, useState } from "react";
import type { AgentModel, AgentModels } from "@/lib/types";

const STORAGE_KEY = "adwise.agent.model";

/**
 * The models the agent offers and the one this browser last picked. Until the
 * list loads (or if it can't), `model` is undefined and the server's default answers.
 */
export function useAgentModels() {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [model, setModelState] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    fetch("/agent/models")
      .then((res) => (res.ok ? (res.json() as Promise<AgentModels>) : null))
      .then((list) => {
        if (cancelled || !list) return;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(STORAGE_KEY);
        } catch {
          // Storage blocked: fall back to the default.
        }
        setModels(list.models);
        setModelState(list.models.some((m) => m.id === saved) ? saved! : list.default);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setModel = (id: string) => {
    setModelState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Only a convenience.
    }
  };

  return { models, model, setModel };
}
