"use client";

import { useEffect, useState } from "react";

/**
 * Reveals `text` a few characters per frame, so text that arrives in bursts
 * reads like steady typing. The pace scales with the backlog, so it never falls
 * far behind the stream. Text that was already there on mount (a restored chat)
 * and reduced-motion users get the whole text at once.
 */
export function useSmoothText(text: string, animate: boolean): { text: string; revealing: boolean } {
  const [shown, setShown] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (shown >= text.length) return;
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setShown((n) => (reduced ? text.length : Math.min(text.length, n + Math.max(2, Math.ceil((text.length - n) / 10)))));
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, text.length]);

  const visible = Math.min(shown, text.length);
  return { text: text.slice(0, visible), revealing: visible < text.length };
}
