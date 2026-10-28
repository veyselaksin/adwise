import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML in answers is not rendered (react-markdown's default), only Markdown.
const components: Components = {
  p: (props) => <p className="leading-relaxed [&:not(:first-child)]:mt-2" {...props} />,
  ul: (props) => <ul className="mt-2 list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="mt-2 list-decimal space-y-1 pl-5" {...props} />,
  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
  a: (props) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props} />,
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
