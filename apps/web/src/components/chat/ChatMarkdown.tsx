import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type ChatMarkdownProps = {
  content: string;
  className?: string;
  streaming?: boolean;
};

export function ChatMarkdown({
  content,
  className,
  streaming = false,
}: ChatMarkdownProps) {
  if (!content.trim()) return null;

  return (
    <div
      className={cn(
        "chat-markdown text-sm leading-relaxed text-foreground",
        streaming && "streaming-text",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-90"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children }) => {
            const isBlock = Boolean(codeClassName);
            if (isBlock) {
              return (
                <code className={cn("font-mono text-xs", codeClassName)}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-none border border-border bg-background px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto border border-border bg-background p-2 font-mono text-xs last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto border border-border">
              <table className="w-full min-w-full border-collapse text-xs">
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
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
