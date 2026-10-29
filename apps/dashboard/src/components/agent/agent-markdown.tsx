"use client";

import { CodeIcon, WrapTextIcon } from "lucide-react";
import { useState } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@components/ui/button";
import { cn } from "@lib/utils";
import { CopyButton } from "./copy-button";

/** react-markdown's syntax tree nodes (hast), without depending on its types package. */
type Element = NonNullable<ExtraProps["node"]>;
type ElementContent = Element["children"][number];

// Raw HTML in answers is not rendered (react-markdown's default), only Markdown.
const components: Components = {
  p: (props) => <p className="leading-relaxed [&:not(:first-child)]:mt-2" {...props} />,
  ul: (props) => <ul className="mt-2 list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="mt-2 list-decimal space-y-1 pl-5" {...props} />,
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  a: (props) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props} />,
  // Fenced blocks (e.g. "write it as markdown") become a card with copy and wrap.
  pre: ({ node }) => <CodeBlock code={node} />,
  table: (props) => (
    <div className="mt-2 overflow-x-auto rounded-md border">
      <table className="w-full text-xs tabular-nums" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b bg-muted/50 px-2 py-1.5 text-left font-medium whitespace-nowrap" {...props} />,
  td: (props) => <td className="border-b px-2 py-1.5 whitespace-nowrap [tr:last-child_&]:border-b-0" {...props} />,
};

export function AgentMarkdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-foreground/90">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}

const LANGUAGE_NAMES: Record<string, string> = { md: "Markdown", markdown: "Markdown", json: "JSON", csv: "CSV", sql: "SQL" };

/** A fenced code block: its language, a copy button and a wrap toggle, like a chat app's code card. */
function CodeBlock({ code: pre }: { code?: Element }) {
  const [wrap, setWrap] = useState(true);
  const code = pre?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const language = languageOf(code);
  const text = (code ? textOf(code) : "").replace(/\n$/, "");
  const markdown = language === "md" || language === "markdown";

  return (
    <div className="mt-2 overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CodeIcon className="size-3.5" />
          {(language && LANGUAGE_NAMES[language]) ?? (language || "Code")}
        </span>
        <span className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            aria-label="Wrap lines"
            title={wrap ? "Don't wrap lines" : "Wrap lines"}
          >
            <WrapTextIcon />
          </Button>
          <CopyButton iconOnly label="Copy" text={text} />
        </span>
      </div>
      <pre className={cn("max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
        <code>
          {markdown
            ? text.split("\n").map((line, i) => (
                // Headings stand out, as in an editor.
                <span key={i} className={cn("block min-h-[1lh]", /^#{1,6}\s/.test(line) && "font-semibold text-primary")}>
                  {line}
                </span>
              ))
            : text}
        </code>
      </pre>
    </div>
  );
}

/** `language-markdown` → `markdown`. */
function languageOf(code?: Element): string {
  const classes = code?.properties.className;
  const list = Array.isArray(classes) ? classes.map(String) : [];
  return list.find((c) => c.startsWith("language-"))?.slice("language-".length).toLowerCase() ?? "";
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  return node.type === "element" ? node.children.map(textOf).join("") : "";
}
