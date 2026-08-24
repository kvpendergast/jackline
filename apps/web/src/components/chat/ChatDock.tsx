import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import type { UIMessage } from "@tanstack/ai-react";
import {
  History,
  Maximize2,
  Minimize2,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  DEFAULT_CHAT_THREAD_TITLE,
  type PublicChatSession,
  type PublicChatThreadSummary,
} from "@jackline/shared";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError } from "@/lib/api";
import { jacklineApi } from "@/lib/jackline-api";
import { cn } from "@/lib/utils";

type Layout = "closed" | "drawer" | "expanded";

function lastThreadStorageKey(tenantId: string) {
  return `jackline.chat.lastThread.${tenantId}`;
}

function formatThreadTime(iso: string): string {
  const then = new Date(iso).getTime();
  const delta = Date.now() - then;
  if (delta < 45_000) return "Just now";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))}h`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

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

function ChatTranscript({ messages }: { messages: UIMessage[] }) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "max-w-[95%] border border-border p-3 text-sm",
            message.role === "user" ? "ml-auto bg-secondary" : "bg-card",
          )}
        >
          <div className="section-label mb-1">
            {message.role === "user" ? "You" : "Jackline"}
          </div>
          {message.parts.map((part, idx) => {
            if (part.type === "thinking") {
              return (
                <details key={idx} className="mb-2 text-muted-foreground">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider">
                    Thinking
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs italic">
                    {partContent(part)}
                  </pre>
                </details>
              );
            }
            if (part.type === "text") {
              return (
                <p key={idx} className="whitespace-pre-wrap">
                  {partContent(part)}
                </p>
              );
            }
            if (part.type === "tool-call") {
              const failed =
                "output" in part &&
                typeof part.output === "object" &&
                part.output != null &&
                "isError" in part.output;
              const args = partInput(part);
              return (
                <div
                  key={idx}
                  className="my-2 border border-border bg-background p-2 font-mono text-xs"
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
      ))}
    </div>
  );
}

function ThreadList({
  threads,
  activeId,
  onSelect,
}: {
  threads: PublicChatThreadSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (threads.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        No saved chats yet. Send a message to start one.
      </p>
    );
  }
  return (
    <ul className="py-1">
      {threads.map((thread) => {
        const active = thread.id === activeId;
        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onSelect(thread.id)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-2 text-left text-sm",
                active
                  ? "border-primary bg-secondary"
                  : "border-transparent hover:bg-muted",
              )}
            >
              <span className="line-clamp-2 font-medium">{thread.title}</span>
              <span className="section-label">
                {formatThreadTime(thread.lastMessageAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ChatSession({
  tenantId,
  threadId,
  initialMessages,
  pendingSend,
  session,
  sessionError,
  isFullAdmin,
  onPendingSendConsumed,
  onPersist,
  onNeedThread,
}: {
  tenantId: string;
  threadId: string | null;
  initialMessages: UIMessage[];
  pendingSend: string | null;
  session: PublicChatSession | null;
  sessionError: string | null;
  isFullAdmin: boolean;
  onPendingSendConsumed: () => void;
  onPersist: (threadId: string | null, messages: UIMessage[]) => void;
  onNeedThread: (id: string, text: string) => void;
}) {
  const [input, setInput] = useState("");
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
    initialMessages,
    ...(threadId ? { threadId } : {}),
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const wasLoading = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    if (wasLoading.current && !isLoading && messagesRef.current.length > 0) {
      onPersist(threadId, messagesRef.current);
    }
    wasLoading.current = isLoading;
  }, [isLoading, onPersist, threadId]);

  useEffect(() => {
    return () => {
      if (messagesRef.current.length > 0) {
        onPersist(threadId, messagesRef.current);
      }
    };
  }, [onPersist, threadId]);

  useEffect(() => {
    if (!pendingSend || !threadId) return;
    void sendMessage(pendingSend);
    onPendingSendConsumed();
  }, [pendingSend, threadId, sendMessage, onPendingSendConsumed]);

  const toolsAllowed = (session?.tools ?? []).filter((t) => t.allowed);
  const servers = [...new Set(toolsAllowed.map((t) => t.serverName))];
  const llmReady = Boolean(session?.llm.configured);
  const canSend = llmReady && !isLoading;
  const settingsHint =
    error instanceof ApiError && error.code === "BAD_REQUEST";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !canSend) return;
    setInput("");
    if (!threadId) {
      try {
        const created = await jacklineApi.createChatThread(tenantId);
        onNeedThread(created.id, text);
      } catch {
        setInput(text);
      }
      return;
    }
    void sendMessage(text);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-4 py-2">
        <span className="section-label">{toolsAllowed.length} tools</span>
        {servers.slice(0, 6).map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
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
                <ChatTranscript messages={messages} />
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form
        className="flex shrink-0 gap-2 border-t border-border bg-card p-3"
        onSubmit={(e) => void onSubmit(e)}
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
    </>
  );
}

function ChatDockInner({ tenantId }: { tenantId: string }) {
  const { membership } = useAuth();
  const isFullAdmin = membership?.role === "full_admin";
  const [layout, setLayout] = useState<Layout>("closed");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [session, setSession] = useState<PublicChatSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [threads, setThreads] = useState<PublicChatThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const rememberThread = useCallback((id: string | null) => {
    const key = lastThreadStorageKey(tenantId);
    if (!id) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, id);
  }, [tenantId]);

  const persistMessages = useCallback(
    async (id: string | null, messages: UIMessage[]) => {
      if (!id || messages.length === 0) return;
      try {
        const saved = await jacklineApi.updateChatThread(tenantId, id, {
          messages: messages as import("@jackline/shared").ChatUiMessage[],
        });
        setInitialMessages(messages);
        setThreads((current) => {
          const rest = current.filter((row) => row.id !== saved.id);
          return [
            {
              id: saved.id,
              title: saved.title,
              lastMessageAt: saved.lastMessageAt,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
            },
            ...rest,
          ];
        });
      } catch {
        // Keep the in-memory transcript; the next successful turn retries save.
      }
    },
    [tenantId],
  );

  const openThread = useCallback(
    async (id: string) => {
      const row = await jacklineApi.getChatThread(tenantId, id);
      setThreadId(row.id);
      setInitialMessages(row.messages as UIMessage[]);
      setPendingSend(null);
      setSessionKey((n) => n + 1);
      setHistoryOpen(false);
      rememberThread(row.id);
    },
    [rememberThread, tenantId],
  );

  const startNewChat = useCallback(() => {
    setThreadId(null);
    setInitialMessages([]);
    setPendingSend(null);
    setSessionKey((n) => n + 1);
    setHistoryOpen(false);
    rememberThread(null);
  }, [rememberThread]);

  const onNeedThread = useCallback(
    (id: string, text: string) => {
      setThreadId(id);
      setInitialMessages([]);
      setPendingSend(text);
      setSessionKey((n) => n + 1);
      rememberThread(id);
      const now = new Date().toISOString();
      setThreads((current) => [
        {
          id,
          title: DEFAULT_CHAT_THREAD_TITLE,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        },
        ...current.filter((row) => row.id !== id),
      ]);
    },
    [rememberThread],
  );

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
    let cancelled = false;
    void (async () => {
      try {
        const page = await jacklineApi.listChatThreads(tenantId);
        if (cancelled) return;
        setThreads(page.items);
        const savedId = localStorage.getItem(lastThreadStorageKey(tenantId));
        const restoreId =
          (savedId && page.items.some((row) => row.id === savedId)
            ? savedId
            : null) ?? page.items[0]?.id;
        if (!restoreId) return;
        const row = await jacklineApi.getChatThread(tenantId, restoreId);
        if (cancelled) return;
        setThreadId(row.id);
        setInitialMessages(row.messages as UIMessage[]);
        setSessionKey((n) => n + 1);
        rememberThread(row.id);
      } catch {
        if (!cancelled) setThreads([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rememberThread, tenantId]);

  const headerTitle =
    threads.find((row) => row.id === threadId)?.title ?? DEFAULT_CHAT_THREAD_TITLE;

  const historyPanel = (
    <ScrollArea className="min-h-0 flex-1">
      <ThreadList
        threads={threads}
        activeId={threadId}
        onSelect={(id) => void openThread(id)}
      />
    </ScrollArea>
  );

  const sessionNode = (
    <ChatSession
      key={sessionKey}
      tenantId={tenantId}
      threadId={threadId}
      initialMessages={initialMessages}
      pendingSend={pendingSend}
      session={session}
      sessionError={sessionError}
      isFullAdmin={isFullAdmin}
      onPendingSendConsumed={() => setPendingSend(null)}
      onPersist={(id, messages) => void persistMessages(id, messages)}
      onNeedThread={onNeedThread}
    />
  );

  function chrome(opts: { showHistoryToggle: boolean; showInlineHistory: boolean }) {
    return (
      <div className="lattice-bg flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{headerTitle}</div>
            <div className="section-label mt-0.5">
              Your tools, through Jackline policy
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="New chat"
              onClick={startNewChat}
            >
              <Plus className="size-3.5" />
            </Button>
            {opts.showHistoryToggle ? (
              <Button
                type="button"
                size="icon-sm"
                variant={historyOpen ? "secondary" : "outline"}
                aria-label="Chat history"
                aria-pressed={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <History className="size-3.5" />
              </Button>
            ) : null}
            {layout === "drawer" ? (
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Expand Chat"
                onClick={() => {
                  setLayout("expanded");
                  setHistoryOpen(false);
                }}
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
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">{sessionNode}</div>
          {opts.showInlineHistory && historyOpen ? (
            <div className="absolute inset-0 z-10 flex flex-col border-t border-border bg-background">
              {historyPanel}
            </div>
          ) : null}
        </div>
        <div className="section-label border-t border-border bg-card px-3 py-1.5 text-center">
          client: Jackline Chat
        </div>
      </div>
    );
  }

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
          {chrome({ showHistoryToggle: true, showInlineHistory: true })}
        </div>
      ) : null}

      {layout === "expanded" ? (
        <div className="fixed inset-0 z-50 flex bg-background">
          <div className="mx-auto flex h-full w-full max-w-5xl border-x border-border">
            <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
              <div className="flex h-14 items-center justify-between border-b border-border px-3">
                <span className="text-sm font-medium">Chats</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="New chat"
                  onClick={startNewChat}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              {historyPanel}
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              {chrome({ showHistoryToggle: false, showInlineHistory: false })}
            </div>
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
