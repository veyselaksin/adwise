"use client";

import {
  AlertCircleIcon,
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  CornerDownRightIcon,
  DownloadIcon,
  Loader2Icon,
  RotateCcwIcon,
  SparklesIcon,
  SquareIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_QUESTION_CHARS } from "@/constants/agent.constant";
import type { AgentDownload, AgentStep, AgentTurn } from "@/types/agent.type";
import { cn } from "@/lib/utils";
import { AgentMarkdown } from "./agent-markdown";
import { CopyButton } from "./copy-button";
import { PinButton } from "./pin-button";
import { useAgentChat } from "./use-agent-chat";
import { useAgentModels } from "./use-agent-models";
import { useSmoothText } from "./use-smooth-text";

/** Entrance for anything that appears while an answer streams; skipped for reduced motion. */
const ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300";

const SUGGESTIONS = [
  "Which US ad set had the lowest CAC over the last 14 days?",
  "Why did CAC go up yesterday?",
  "Is TikTok cheaper than Meta for us right now?",
  "Which ad sets are spending over their budget?",
  "Did the iOS 3.46.0 release change trial → sub?",
];

export function AgentPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { models, model, setModel } = useAgentModels();
  const { turns, busy, ask, stop, reset, retry } = useAgentChat(model);
  const labels = Object.fromEntries(models.map((m) => [m.id, m.label]));
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  // Follow the answer as it grows, unless the user has scrolled up to read.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    let pinned = true;
    const onScroll = () => {
      pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    };
    const observer = new ResizeObserver(() => {
      if (pinned) scroller.scrollTop = scroller.scrollHeight;
    });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(content);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  // A new question always jumps to the bottom.
  const turnCount = turns.length;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turnCount]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = (question = draft) => {
    if (!question.trim() || busy) return;
    void ask(question);
    setDraft("");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <aside
      aria-label="ADWISE agent"
      hidden={!open}
      className="fixed inset-x-0 top-24 bottom-0 z-30 sm:top-14 flex flex-col border-l bg-background shadow-lg lg:left-auto lg:w-[26rem] lg:shadow-none"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <SparklesIcon className="size-4 text-muted-foreground" />
          Ask ADWISE
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={reset} disabled={turns.length === 0} aria-label="New chat" title="New chat">
            <SquarePenIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close agent" title="Close">
            <XIcon />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        <div ref={contentRef}>
          {turns.length === 0 ? (
            <Intro onPick={submit} />
          ) : (
            <div className="flex flex-col gap-6">
              {turns.map((turn, i) => (
                <Turn
                  key={turn.id}
                  turn={turn}
                  modelLabel={turn.usage && (labels[turn.usage.model] ?? turn.usage.model)}
                  onRetry={i === turns.length - 1 ? retry : undefined}
                  onAsk={i === turns.length - 1 && !busy ? ask : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t p-3">
        <div className="relative">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_QUESTION_CHARS}
            rows={2}
            placeholder="Ask about spend, CAC, ad sets, releases…"
            aria-label="Your question"
            className="max-h-40 min-h-16 resize-none pr-11"
          />
          {busy ? (
            <Button type="button" size="icon-sm" variant="secondary" onClick={stop} aria-label="Stop" title="Stop" className="absolute right-2 bottom-2">
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon-sm" disabled={!draft.trim()} aria-label="Send" title="Send (Enter)" className="absolute right-2 bottom-2">
              <ArrowUpIcon />
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[0.7rem] text-muted-foreground">Same data as the dashboard.</p>
          {models.length > 0 && model && (
            <Select
              items={models.map((m) => ({ value: m.id, label: m.label }))}
              value={model}
              onValueChange={(v) => v && setModel(v)}
              disabled={busy}
            >
              <SelectTrigger
                size="sm"
                aria-label="Model"
                className="h-6 shrink-0 gap-1 border-transparent bg-transparent px-1.5 text-[0.7rem] text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-transparent [&_svg:not([class*='size-'])]:size-3"
              >
                <BotIcon />
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" align="end" sideOffset={6} alignItemWithTrigger={false} className="w-72 p-1">
                <SelectGroup>
                  <SelectLabel>Answer with</SelectLabel>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="py-1.5">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{m.label}</span>
                        <span className="text-xs whitespace-normal text-muted-foreground">{m.description}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>
      </form>
    </aside>
  );
}

function Intro({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Ask what the dashboard doesn&apos;t show.</p>
        <p className="mt-1">
          The agent reads the same metrics, budgets and build logs, and follows the team&apos;s glossary and notes. Each
          lookup it makes is listed with its answer.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

type TurnProps = {
  turn: AgentTurn;
  modelLabel?: string;
  onRetry?: () => void;
  /** Asks a follow-up; only the latest turn offers them. */
  onAsk?: (question: string) => void;
};

function Turn({ turn, modelLabel, onRetry, onAsk }: TurnProps) {
  const working = turn.status === "streaming";
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          ENTER,
          "ml-8 self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground motion-safe:slide-in-from-right-2",
        )}
      >
        {turn.question}
      </div>

      {(turn.steps.length > 0 || (working && !turn.answer && !turn.draft)) && (
        <ol className="flex flex-col gap-1.5" aria-label="Steps">
          {turn.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
          {working && !turn.answer && !turn.draft && turn.steps.every((s) => s.status !== "running") && (
            <li className={cn(ENTER, "flex items-center gap-2 text-xs text-muted-foreground")}>
              <Loader2Icon className="size-3.5 animate-spin" />
              <span className="shimmer-text">
                {turn.steps.length === 0 ? "Reading the question…" : "Working out the answer…"}
              </span>
            </li>
          )}
        </ol>
      )}

      {turn.notes.map((note, i) => (
        <p key={i} className={cn(ENTER, "text-xs text-muted-foreground italic")}>
          {note}
        </p>
      ))}

      {(turn.answer ?? turn.draft) && (
        // A note ends a text segment; the next one types in fresh.
        <StreamedText key={turn.notes.length} text={turn.answer ?? hideFollowUps(turn.draft)} streaming={working} />
      )}

      {turn.downloads.length > 0 && (
        <div className={cn(ENTER, "flex flex-wrap gap-2")}>
          {turn.downloads.map((d) => (
            <DownloadLink key={d.id} download={d} />
          ))}
          {turn.downloads
            .filter((d) => d.format === "md")
            .map((d) => (
              <CopyButton key={`copy-${d.id}`} label="Copy Markdown" text={() => fetchText(d.href)} />
            ))}
        </div>
      )}

      {turn.error && (
        <div role="alert" className={cn(ENTER, "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm")}>
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p>{turn.error.message}</p>
            {turn.error.code === "UNAUTHORIZED" ? (
              <a href="/login?expired=1" className="mt-1 inline-block text-xs underline underline-offset-2">
                Sign in again
              </a>
            ) : (
              onRetry && <RetryButton onRetry={onRetry} />
            )}
          </div>
        </div>
      )}

      {turn.status === "stopped" && !turn.answer && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Stopped. {onRetry && <RetryButton onRetry={onRetry} />}
        </div>
      )}

      {turn.usage && turn.answer && (
        <div className={cn(ENTER, "flex items-center justify-between gap-2")}>
          <p className="text-[0.7rem] text-muted-foreground tabular-nums">
            {modelLabel && `${modelLabel} · `}
            {turn.usage.steps} model call{turn.usage.steps === 1 ? "" : "s"} · {formatTokens(turn.usage.tokens)}{" "}
            tokens
          </p>
          <div className="flex items-center">
            <PinButton question={turn.question} steps={turn.steps} />
            <CopyButton label="Copy answer" iconOnly text={turn.answer} />
          </div>
        </div>
      )}

      {onAsk && turn.status === "done" && turn.answer && turn.followUps && turn.followUps.length > 0 && (
        <div className={cn(ENTER, "flex flex-col items-start gap-1.5")} aria-label="Follow-up questions">
          {turn.followUps.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAsk(q)}
              className="flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
            >
              <CornerDownRightIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The answer as it streams: typed in smoothly, with a caret until it catches up. */
function StreamedText({ text, streaming }: { text: string; streaming: boolean }) {
  const smooth = useSmoothText(text, streaming);
  return (
    <div aria-busy={streaming || smooth.revealing}>
      <AgentMarkdown>{smooth.text}</AgentMarkdown>
      {(streaming || smooth.revealing) && (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 rounded-full bg-foreground/70 motion-safe:animate-pulse"
        />
      )}
    </div>
  );
}

function Step({ step }: { step: AgentStep }) {
  const icon = "size-3.5 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:duration-200";
  return (
    <li className={cn(ENTER, "flex items-start gap-2 text-xs motion-safe:slide-in-from-bottom-1")}>
      <span className="mt-px grid size-3.5 shrink-0 place-items-center">
        {step.status === "running" ? (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        ) : step.status === "ok" ? (
          <CheckIcon className={cn(icon, "text-muted-foreground")} />
        ) : (
          <AlertCircleIcon className={cn(icon, "text-destructive")} />
        )}
      </span>
      <span className="min-w-0">
        <span className={step.status === "running" ? "shimmer-text" : "text-foreground/80"}>{step.label}</span>
        {step.summary && (
          <span
            className={cn(
              "ml-1.5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300",
              step.status === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            — {step.summary}
          </span>
        )}
      </span>
    </li>
  );
}

const FORMAT_NAMES: Record<AgentDownload["format"], string> = { pdf: "PDF", xlsx: "Excel", csv: "CSV", json: "JSON", md: "Markdown" };

/** The file the agent prepared; it downloads when the user clicks. */
function DownloadLink({ download }: { download: AgentDownload }) {
  return (
    <Button variant="outline" size="xs" nativeButton={false} render={<a href={download.href} download title={download.label} />}>
      <DownloadIcon /> Download {FORMAT_NAMES[download.format]}
    </Button>
  );
}

/** The exported file's text; fails on an error response instead of copying its JSON. */
async function fetchText(href: string): Promise<string> {
  const res = await fetch(href);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return res.text();
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="outline" size="xs" onClick={onRetry} className="mt-1.5">
      <RotateCcwIcon /> Try again
    </Button>
  );
}

/**
 * The answer as it streams, without the hidden follow-up block the model writes
 * last (the server strips it from the final answer), even when half-written.
 */
const hideFollowUps = (text: string) => text.replace(/<!--[\s\S]*$/, "").replace(/<!?-?$/, "");

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
