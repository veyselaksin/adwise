"use client";

import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@components/ui/card";
import { BRIEF_COLLAPSED_EVENT, STORAGE_KEYS } from "@constants/storage";
import { cn } from "@lib/utils";

// Collapsed or not is a per-browser convenience: storage may be blocked, and then it simply stays open.
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.briefCollapsed) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(BRIEF_COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(BRIEF_COLLAPSED_EVENT, onChange);
  };
}

/** The morning brief's card: a header that folds it away, with `summary` shown while folded. */
export function BriefFrame({ title, summary, children }: { title: ReactNode; summary: string; children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const toggle = () => {
    try {
      localStorage.setItem(STORAGE_KEYS.briefCollapsed, collapsed ? "0" : "1");
    } catch {
      // Blocked storage: nothing to remember it in.
    }
    window.dispatchEvent(new Event(BRIEF_COLLAPSED_EVENT));
  };

  return (
    <Card className={cn("gap-3", collapsed && "py-3")}>
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="morning-brief-body"
            className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left hover:text-foreground/80"
          >
            {title}
            <ChevronDownIcon
              className={cn("ml-auto size-4 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
              aria-hidden="true"
            />
            <span className="sr-only">{collapsed ? "Show the brief" : "Hide the brief"}</span>
          </button>
        </CardTitle>
        {collapsed && <CardDescription>{summary}</CardDescription>}
      </CardHeader>
      {!collapsed && (
        <div id="morning-brief-body" className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </Card>
  );
}
