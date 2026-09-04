import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  Maximize2,
  Minimize2,
  MessageSquare,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { UIMessage } from "@tanstack/ai-react";
import type { PublicChatSession } from "@jackline/shared";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { useChatAutoScroll } from "@/components/chat/useChatAutoScroll";
import { useIsDesktop } from "@/hooks/use-media-query";

type Layout = "closed" | "drawer" | "expanded";

function partContent(part: unknown): string {
  if (part && typeof part === "object" && "content" in part) {
    const value = (part as { content?: unknown }).content;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function partInput(part: unknown): unknown {
  if (!part || typeof part !== "object") return undefined;
  if ("input" in part) return (part as { input?: unknown }).input;
  if ("arguments" in part) return (part as { arguments?: unknown }).arguments;
  return undefined;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 pl-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}

function ChatThinkingBlock({
  content,
  active,
}: {
  content: string;
  active: boolean;
}) {
  return (
    <details
      open={active ? true : undefined}
      className="mb-3 overflow-hidden border border-border bg-background/80 transition-colors duration-300"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-primary transition-opacity duration-300",
            active ? "animate-pulse opacity-100" : "opacity-60",
          )}
        />
        <span>Thinking</span>
        {active ? <ThinkingDots /> : null}
      </summary>
      <div className="border-t border-border px-3 py-2 text-xs italic text-muted-foreground transition-[max-height,opacity] duration-300 ease-out">
        <pre className="whitespace-pre-wrap font-sans">
          {content.trim() || "Working through the request…"}
        </pre>
      </div>
    </details>
  );
}

function ChatTranscript({
  messages,
  isLoading,
}: {
  messages: UIMessage[];
  isLoading: boolean;
}) {
  const lastId = messages.at(-1)?.id;

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isLastAssistant =
          isLoading && message.role === "assistant" && message.id === lastId;

        return (
          <div
            key={message.id}
            className={cn(
              "border border-border p-3 text-sm transition-[opacity,transform] duration-200 ease-out",
              message.role === "user"
                ? "ml-auto max-w-[min(100%,42rem)] bg-secondary"
                : "max-w-[min(100%,52rem)] bg-card",
            )}
          >
            <div className="section-label mb-2">
              {message.role === "user" ? "You" : "Jackline"}
            </div>
            {message.parts.map((part, idx) => {
              if (part.type === "thinking") {
                return (
                  <ChatThinkingBlock
                    key={idx}
                    content={partContent(part)}
                    active={
                      isLastAssistant &&
                      idx === message.parts.length - 1 &&
                      isLoading
                    }
                  />
                );
              }
              if (part.type === "text") {
                const text = partContent(part);
                const streaming =
                  isLastAssistant &&
                  idx === message.parts.length - 1 &&
                  isLoading;
                return (
                  <ChatMarkdown
                    key={idx}
                    content={text}
                    streaming={streaming}
                  />
                );
              }
              if (part.type === "tool-call") {
                const failed =
                  "output" in part &&
                  typeof part.output === "object" &&
                  part.output != null &&
                  "isError" in part.output;
                const args = partInput(part);
                const running =
                  isLastAssistant &&
                  part.state !== "complete" &&
                  part.state !== "error";
                return (
                  <div
                    key={idx}
                    className={cn(
                      "my-2 border border-border bg-background p-2 font-mono text-xs transition-opacity duration-200",
                      running && "animate-pulse opacity-90",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{part.name}</span>
                      <Badge variant={failed ? "deny" : "allow"}>
                        {failed
                          ? "deny"
                          : part.state === "input-complete"
                            ? "complete"
                            : (part.state ?? "running")}
                      </Badge>
                    </div>
                    {args != null ? (
                      <>
                        <div className="section-label mt-2">Args</div>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                          {JSON.stringify(args, null, 2)}
                        </pre>
                      </>
                    ) : null}
                  </div>
                );
              }
              return null;
            })}
          </div>
        );
      })}
      {isLoading &&
      (messages.length === 0 || messages.at(-1)?.role === "user") ? (
        <div className="flex max-w-[min(100%,52rem)] items-center gap-2 border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          <span>Jackline is thinking</span>
          <ThinkingDots />
        </div>
      ) : null}
    </div>
  );
}

function ChatPanel({
  layout,
  onLayoutChange,
  isFullAdmin,
  session,
  sessionError,
  messages,
  sendMessage,
  isLoading,
  stop,
  error,
}: {
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
  isFullAdmin: boolean;
  session: PublicChatSession | null;
  sessionError: string | null;
  messages: UIMessage[];
  sendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  stop: () => void;
  error: Error | null;
}) {
  const [input, setInput] = useState("");
  const { scrollRef, onScroll } = useChatAutoScroll([messages, isLoading, layout]);

  const toolsAllowed = (session?.tools ?? []).filter(
    (t: PublicChatSession["tools"][number]) => t.allowed,
  );
  const servers = [
    ...new Set(
      toolsAllowed.map((t: PublicChatSession["tools"][number]) => t.serverName),
    ),
  ];
  const llmReady = Boolean(session?.llm.configured);
  const canSend = llmReady && !isLoading;
  const settingsHint =
    error instanceof ApiError && error.code === "BAD_REQUEST";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !canSend) return;
    setInput("");
    void sendMessage(text);
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-background",
        layout === "expanded" ? "h-dvh lattice-bg" : "h-full lattice-bg",
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div>
          <div className="text-sm font-medium">Chat</div>
          <div className="section-label mt-0.5">
            Your tools, through Jackline policy
          </div>
        </div>
        <div className="flex items-center gap-1">
          {layout === "drawer" ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Expand Chat"
              onClick={() => onLayoutChange("expanded")}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Dock Chat"
              onClick={() => onLayoutChange("drawer")}
            >
              <Minimize2 className="size-3.5" />
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Close Chat"
            onClick={() => onLayoutChange("closed")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-4 py-2">
        <span className="section-label">{toolsAllowed.length} tools</span>
        {servers.slice(0, 6).map((name: string) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div className={cn("p-4", layout === "expanded" && "px-6 py-5")}>
          {sessionError ? (
            <p className="text-sm text-deny">{sessionError}</p>
          ) : null}
          {error ? <p className="text-sm text-deny">{error.message}</p> : null}
          {settingsHint && isFullAdmin ? (
            <Button asChild className="mb-4" size="sm">
              <Link to="/settings">Open Settings</Link>
            </Button>
          ) : null}
          {!llmReady ? (
            <div className="border border-border bg-card p-4 text-sm">
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
                <div className="mb-4 border border-border bg-card p-4 text-sm">
                  <div className="font-medium">No tools on this connection</div>
                  <p className="mt-1 text-muted-foreground">
                    This chat uses the Jackline Chat client. It can only see and
                    use tools that have been granted to your roles for this
                    connection. You can still talk to the model.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button asChild size="sm">
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
                <ChatTranscript messages={messages} isLoading={isLoading} />
              )}
            </>
          )}
        </div>
      </div>

      <form
        className={cn(
          "flex shrink-0 gap-2 border-t border-border bg-card p-3",
          layout === "expanded" && "px-6",
        )}
        onSubmit={onSubmit}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            toolsAllowed.length === 0 ? "Send a message…" : "Ask your tools…"
          }
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
      <div
        className={cn(
          "section-label shrink-0 border-t border-border bg-card px-3 py-1.5 text-center",
        )}
      >
        client: Jackline Chat
      </div>
    </div>
  );
}

function ChatOverlay({
  layout,
  children,
}: {
  layout: Layout;
  children: ReactNode;
}) {
  if (layout === "closed") return null;

  if (layout === "drawer") {
    return (
      <div className="fixed inset-y-0 right-0 z-50 flex w-[min(100%,400px)] border-l border-border pb-[env(safe-area-inset-bottom)] shadow-none pt-[env(safe-area-inset-top)]">
        {children}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      {children}
    </div>
  );
}

function ChatDockInner({ tenantId }: { tenantId: string }) {
  const { membership } = useAuth();
  const isDesktop = useIsDesktop();
  const isFullAdmin = membership?.role === "full_admin";
  const [layout, setLayout] = useState<Layout>("closed");
  const [session, setSession] = useState<PublicChatSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  function openChat() {
    setLayout(isDesktop ? "drawer" : "expanded");
  }

  function toggleChat() {
    if (layout === "closed") {
      openChat();
      return;
    }
    setLayout("closed");
  }

  // If the viewport grows while in expanded-from-mobile, keep expanded;
  // if it shrinks while in drawer, promote to expanded for usability.
  useEffect(() => {
    if (!isDesktop && layout === "drawer") {
      setLayout("expanded");
    }
  }, [isDesktop, layout]);

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
    if (layout !== "expanded") return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [layout]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Open Chat"
        aria-pressed={layout !== "closed"}
        onClick={toggleChat}
      >
        <MessageSquare className="size-3.5" />
      </Button>

      <ChatOverlay layout={layout}>
        <ChatPanel
          layout={layout}
          onLayoutChange={setLayout}
          isFullAdmin={isFullAdmin}
          session={session}
          sessionError={sessionError}
          messages={messages}
          sendMessage={sendMessage}
          isLoading={isLoading}
          stop={stop}
          error={error ?? null}
        />
      </ChatOverlay>
    </>
  );
}

export function ChatDock() {
  const { tenantId } = useAuth();
  if (!tenantId) return null;
  return <ChatDockInner key={tenantId} tenantId={tenantId} />;
}
