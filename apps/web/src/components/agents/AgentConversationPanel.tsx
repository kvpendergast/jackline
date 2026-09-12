import { useEffect, useMemo, useState } from "react";
import type {
  AgentConversationThread,
  AgentTranscriptEntry,
} from "@jackline/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { jacklineApi } from "@/lib/jackline-api";

function kindLabel(kind: AgentTranscriptEntry["kind"]): string {
  switch (kind) {
    case "knock":
      return "Knock";
    case "decision":
      return "Decision";
    case "peer_message":
      return "Peer";
    case "agent_message":
      return "Agent";
    case "tool_call":
      return "Tool";
  }
}

function EntryBubble({ entry }: { entry: AgentTranscriptEntry }) {
  const isPeer =
    entry.kind === "knock" ||
    entry.kind === "peer_message" ||
    entry.kind === "tool_call";
  const isSystem = entry.kind === "decision";

  return (
    <div
      className={cn(
        "flex w-full",
        isSystem ? "justify-center" : isPeer ? "justify-start" : "justify-end",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] space-y-1 rounded-lg px-3 py-2 text-sm",
          isSystem
            ? "bg-muted text-muted-foreground"
            : isPeer
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground",
        )}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
          <span>{kindLabel(entry.kind)}</span>
          <span>{new Date(entry.createdAt).toLocaleString()}</span>
          {entry.status ? <Badge variant="outline">{entry.status}</Badge> : null}
        </div>
        {entry.text ? (
          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
        ) : null}
        {entry.kind === "decision" && entry.decisionNote ? (
          <p className="whitespace-pre-wrap break-words italic">
            Note: {entry.decisionNote}
          </p>
        ) : null}
        {entry.kind === "tool_call" ? (
          <div className="space-y-1 font-mono text-[11px]">
            <div>{entry.toolName ?? "tool"}</div>
            {entry.toolArgs != null ? (
              <pre className="overflow-x-auto whitespace-pre-wrap opacity-80">
                {JSON.stringify(entry.toolArgs, null, 2)}
              </pre>
            ) : null}
            {entry.toolOutput != null ? (
              <pre className="overflow-x-auto whitespace-pre-wrap opacity-80">
                {typeof entry.toolOutput === "string"
                  ? entry.toolOutput
                  : JSON.stringify(entry.toolOutput, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AgentConversationPanel({
  tenantId,
  agentId,
}: {
  tenantId: string;
  agentId: string;
}) {
  const [threads, setThreads] = useState<AgentConversationThread[]>([]);
  const [entries, setEntries] = useState<AgentTranscriptEntry[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const visibleEntries = useMemo(() => {
    if (!selectedPeer) return entries;
    return entries.filter((e) => e.peerAgentCardUrl === selectedPeer);
  }, [entries, selectedPeer]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await jacklineApi.getAgentTranscript(tenantId, agentId);
        if (cancelled) return;
        setThreads(data.threads);
        setEntries(data.entries);
        setSelectedPeer((prev) => prev ?? data.threads[0]?.peerAgentCardUrl ?? null);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load transcript");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, agentId]);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    void (async () => {
      try {
        await jacklineApi.streamAgentTranscript(
          tenantId,
          agentId,
          {
            onSnapshot: (data) => {
              setThreads(data.threads);
              setEntries(data.entries);
              setSelectedPeer(
                (prev) => prev ?? data.threads[0]?.peerAgentCardUrl ?? null,
              );
            },
            onEntry: (entry) => {
              setEntries((prev) =>
                prev.some((e) => e.id === entry.id) ? prev : [...prev, entry],
              );
            },
            onThreads: (next) => setThreads(next),
            onError: (message) => setError(message),
          },
          { signal: controller.signal },
        );
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Live stream failed");
      }
    })();
    return () => controller.abort();
  }, [tenantId, agentId, live]);

  return (
    <section id="conversation" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Conversation</h2>
          <p className="text-sm text-muted-foreground">
            Live transcript of knocks, decisions, messages, and tool calls.
          </p>
        </div>
        <Button
          size="sm"
          variant={live ? "default" : "outline"}
          onClick={() => setLive((v) => !v)}
        >
          {live ? "Live" : "Paused"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        <div className="rounded-md border">
          <ScrollArea className="h-[28rem]">
            <div className="space-y-1 p-2">
              {threads.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No peer conversations yet.
                </p>
              ) : (
                threads.map((thread) => {
                  const active = thread.peerAgentCardUrl === selectedPeer;
                  return (
                    <button
                      key={thread.peerAgentCardUrl}
                      type="button"
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                        active && "bg-muted",
                      )}
                      onClick={() => setSelectedPeer(thread.peerAgentCardUrl)}
                    >
                      <div className="truncate font-medium">
                        {thread.peerDisplayName ?? thread.peerAgentCardUrl}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {thread.knockStatus ?? "active"} · {thread.entryCount}{" "}
                        events
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
        <div className="rounded-md border">
          <ScrollArea className="h-[28rem]">
            <div className="space-y-3 p-3">
              {visibleEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Select a peer to read the transcript.
                </p>
              ) : (
                visibleEntries.map((entry) => (
                  <EntryBubble key={entry.id} entry={entry} />
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </section>
  );
}
