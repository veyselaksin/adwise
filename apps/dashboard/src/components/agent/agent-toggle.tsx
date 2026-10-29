"use client";

import { SparklesIcon } from "lucide-react";
import { Button } from "@components/ui/button";
import { useAgent } from "./agent-provider";

export function AgentToggle() {
  const { open, setOpen } = useAgent();
  return (
    <Button
      variant={open ? "secondary" : "default"}
      size="sm"
      aria-expanded={open}
      aria-label="Ask ADWISE"
      onClick={() => setOpen(!open)}
    >
      <SparklesIcon /> <span className="max-sm:sr-only">Ask ADWISE</span>
    </Button>
  );
}
