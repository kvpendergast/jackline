import { useMemo } from "react";
import {
  Markdown,
  type MarkdownComponents,
} from "@tanstack/markdown/react";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { cn } from "@/lib/utils";

type ChatMarkdownProps = {
  content: string;
  className?: string;
  streaming?: boolean;
};

const chatMarkdownComponents = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="whitespace-pre-wrap">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 text-base font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 text-sm font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 text-sm font-medium">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-90"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-xs", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded-none border border-border bg-background px-1 py-0.5 font-mono text-xs"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children, className, ...props }) => (
    <pre
      className={cn(
        "mb-2 overflow-x-auto border border-border bg-background p-2 font-mono text-xs last:mb-0",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  ),
  table: ({ children, ...props }) => (
    <div className="my-3 overflow-x-auto border border-border">
      <table
        className="w-full min-w-full border-collapse text-xs"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-muted/60">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-foreground">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
} satisfies MarkdownComponents;

export function ChatMarkdown({
  content,
  className,
  streaming = false,
}: ChatMarkdownProps) {
  const extensions = useMemo(
    () => (streaming ? [streamingMarkdownExtension()] : []),
    [streaming],
  );

  if (!content.trim()) return null;

  return (
    <div
      className={cn(
        "chat-markdown text-sm leading-relaxed text-foreground",
        streaming && "streaming-text",
        className,
      )}
    >
      <Markdown
        extensions={extensions}
        frontmatter={false}
        headingIds={false}
        components={chatMarkdownComponents}
      >
        {content}
      </Markdown>
    </div>
  );
}
