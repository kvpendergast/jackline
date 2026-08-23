import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  Maximize2,
  Minimize2,
  MessageSquare,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";
import { cn } from "@/lib/utils";
import type { UIMessage } from "@tanstack/ai-react";
import type { PublicChatSession } from "@jackline/shared";
import { Link } from "react-router-dom";

type Layout = "closed" | "drawer" | "expanded";

function ChatTranscript({ messages }: { messages: UIMessage[] }) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "max-w-[95%] border border-border p-3 text-sm",
            message.role === "user"
              ? "ml-auto bg-secondary"
              : "bg-card",
          )}
        >
          <div className="section-label mb-1">
            {message.role === "user" ? "You" : "Jackline Chat"}
          </div>
          {message.parts.map((part, idx) => {
            if (part.type === "thinking") {
              return (
                <details key={idx} className="mb-2 text-muted-foreground">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider">
                    Thinking
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs italic">
                    {"content" in part ? part.content : ""}
                  </pre>
                </details>
              );
            }
            if (part.type === "text") {
              return (
                <p key={idx} className="whitespace-pre-wrap">
                  {"content" in part ? part.content : ""}
                </p>
              );
            }
            if (part.type === "tool-call") {
              const failed =
                "output" in part &&
                typeof part.output === "object" &&
                part.output != null &&
                "isError" in part.output;
              return (
                <div
                  key={idx}
                  className="my-2 border border-border bg-background p-2 font-mono text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{part.name}</span>
                    <span
                      className={cn(
                        "uppercase tracking-wider",
                        failed ? "text-deny" : "text-allow",
                      )}
                    >
                      {failed
                        ? "deny"
                        : part.state === "input-complete"
                          ? "complete"
                          : part.state ?? "running"}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    via Jackline gateway
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      ))}
    </div>
  );
}

function ChatDockInner({ tenantId }: { tenantId: string }) {
  const { membership } = useAuth();
  const isFullAdmin = membership?.role === "full_admin";
  const [layout, setLayout] = useState<Layout>("closed");
  const [session, setSession] = useState<PublicChatSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const connection = useMemo(
    () =>
      fetchServerSentEvents("/api/v1/chat", () => ({
        credentials: "include" as const,
        headers: { "X-Jackline-Tenant-Id": tenantId },
      })),
    [tenantId],
  );

  const { messages, sendMessage, isLoading, stop, error } = useChat({
    connection,
  });

  useEffect(() => {
    let cancelled = false;
    void jacklineApi
      .getChatSession(tenantId)
      .then((data) => {
        if (!cancelled) {
          setSession(data);
          setSessionError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSessionError(
            err instanceof ApiError ? err.message : "Failed to load Chat",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, layout]);

  const toolsAllowed = (session?.tools ?? []).filter((t) => t.allowed);
  const servers = [...new Set(toolsAllowed.map((t) => t.serverName))];
  const llmReady = Boolean(session?.llm.configured);
  const canSend = llmReady && !isLoading;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !canSend) return;
    setInput("");
    void sendMessage(text);
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <div className="text-sm font-medium">Chat</div>
          <div className="section-label mt-0.5">
            {session?.llm.provider && session.llm.model
              ? `${session.llm.provider} · ${session.llm.model}`
              : "Through your Jackline connection"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {layout === "drawer" ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Expand Chat"
              onClick={() => setLayout("expanded")}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Dock Chat"
              onClick={() => setLayout("drawer")}
            >
              <Minimize2 className="size-3.5" />
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Close Chat"
            onClick={() => setLayout("closed")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
        <span className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {toolsAllowed.length} tools
        </span>
        {servers.slice(0, 6).map((name) => (
          <span
            key={name}
            className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
          >
            {name}
          </span>
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {sessionError ? (
            <p className="text-sm text-deny">{sessionError}</p>
          ) : null}
          {error ? (
            <p className="text-sm text-deny">{error.message}</p>
          ) : null}
          {!llmReady ? (
            <div className="border border-border p-4 text-sm">
              <div className="font-medium">Chat is not configured</div>
              <p className="mt-1 text-muted-foreground">
                {isFullAdmin
                  ? "Set a provider, model, and API key in Settings → Chat."
                  : "Ask a full admin to configure Chat in Settings."}
              </p>
              {isFullAdmin ? (
                <Button asChild className="mt-3" size="sm">
                  <Link to="/settings">Open Settings</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <>
          {toolsAllowed.length === 0 ? (
            <div className="mb-4 border border-border p-4 text-sm">
              <div className="font-medium">No tools on this connection</div>
              <p className="mt-1 text-muted-foreground">
                Grant roles on the Jackline Chat connection. This catalog is
                the same policy Cursor would see. You can still send a
                message; the model has no Jackline tools until then.
              </p>
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/access-requests">Request access</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/my-access">Open My Access</Link>
                </Button>
              </div>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ask your tools. Calls go through the Jackline gateway.
            </p>
          ) : (
            <ChatTranscript messages={messages} />
          )}
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form
        className="flex shrink-0 gap-2 border-t border-border p-3"
        onSubmit={onSubmit}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your tools…"
          disabled={!canSend && !isLoading}
        />
        {isLoading ? (
          <Button type="button" variant="outline" onClick={() => stop()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!canSend || !input.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Open Chat"
        aria-pressed={layout !== "closed"}
        onClick={() => setLayout(layout === "closed" ? "drawer" : "closed")}
      >
        <MessageSquare className="size-3.5" />
      </Button>

      {layout === "drawer" ? (
        <div className="fixed inset-y-0 right-0 z-50 flex w-[min(100%,400px)] border-l border-border shadow-none">
          {panel}
        </div>
      ) : null}

      {layout === "expanded" ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col border-x border-border">
            {panel}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ChatDock() {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return <ChatDockInner key={tenantId} tenantId={tenantId} />;
}
