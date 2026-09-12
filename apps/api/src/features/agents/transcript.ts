import { and, desc, eq } from "drizzle-orm";
import {
  a2aTasks,
  db,
  knocks,
  trustGrants,
  type A2aTask as A2aTaskRow,
  type Knock as KnockRow,
  type TrustGrant as TrustGrantRow,
} from "@jackline/db";
import {
  JACKLINE_TOOL_CALL_INTENT,
  type AgentConversationThread,
  type AgentTranscriptEntry,
  type AgentTranscriptResponse,
} from "@jackline/shared";

function messageTextFromParams(
  params: Record<string, unknown> | null | undefined,
): string | null {
  if (!params) return null;
  const message = params["message"];
  if (!message || typeof message !== "object") return null;
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { kind?: unknown }).kind === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      texts.push((part as { text: string }).text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

function toolCallFromParams(
  params: Record<string, unknown> | null | undefined,
): { name: string; args: unknown } | null {
  if (!params) return null;
  const message = params["message"];
  if (!message || typeof message !== "object") return null;
  const metadata = (message as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const intent = (metadata as { intent?: unknown }).intent;
  if (intent !== JACKLINE_TOOL_CALL_INTENT) return null;
  const tool = (metadata as { tool?: unknown }).tool;
  if (!tool || typeof tool !== "object") return null;
  const name = (tool as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) return null;
  return {
    name,
    args: (tool as { arguments?: unknown }).arguments ?? {},
  };
}

function entriesFromKnock(knock: KnockRow): AgentTranscriptEntry[] {
  const base = {
    peerAgentCardUrl: knock.peerAgentCardUrl,
    peerDisplayName: knock.peerDisplayName ?? null,
    knockId: knock.id,
    trustGrantId: knock.trustGrantId ?? null,
    taskId: knock.a2aTaskId ?? null,
    toolName: null,
    toolArgs: null,
    toolOutput: null,
    taskState: null,
  } as const;

  const out: AgentTranscriptEntry[] = [
    {
      id: `knock:${knock.id}`,
      kind: "knock",
      createdAt: knock.createdAt.toISOString(),
      ...base,
      text: knock.message,
      status: knock.status,
      decisionNote: null,
    },
  ];

  if (knock.status === "approved" || knock.status === "denied") {
    out.push({
      id: `decision:${knock.id}`,
      kind: "decision",
      createdAt: knock.updatedAt.toISOString(),
      ...base,
      text: null,
      status: knock.status,
      decisionNote: knock.decisionNote ?? null,
    });
  }

  return out;
}

function entriesFromHostedTask(
  task: A2aTaskRow,
  grant: TrustGrantRow | undefined,
): AgentTranscriptEntry[] {
  const peerAgentCardUrl =
    grant?.peerAgentCardUrl ?? "https://unknown.invalid/peer";
  const peerDisplayName = grant?.peerDisplayName ?? null;
  const base = {
    peerAgentCardUrl,
    peerDisplayName,
    knockId: task.knockId ?? null,
    trustGrantId: task.trustGrantId ?? null,
    taskId: task.id,
    status: null,
    decisionNote: null,
    taskState: task.state,
  } as const;

  const result = task.result ?? null;
  const mode =
    result && typeof result === "object"
      ? (result as { mode?: unknown }).mode
      : undefined;

  if (mode === "tool_call") {
    const fromParams = toolCallFromParams(task.params);
    return [
      {
        id: `task:${task.id}:tool`,
        kind: "tool_call",
        createdAt: task.createdAt.toISOString(),
        ...base,
        text: messageTextFromParams(task.params),
        toolName:
          typeof (result as { tool?: unknown }).tool === "string"
            ? ((result as { tool: string }).tool)
            : (fromParams?.name ?? null),
        toolArgs: fromParams?.args ?? null,
        toolOutput: (result as { output?: unknown }).output ?? null,
      },
    ];
  }

  const inbound = messageTextFromParams(task.params);
  const outbound =
    result && typeof result === "object" && typeof (result as { message?: unknown }).message === "string"
      ? ((result as { message: string }).message)
      : null;

  const out: AgentTranscriptEntry[] = [];
  if (inbound) {
    out.push({
      id: `task:${task.id}:peer`,
      kind: "peer_message",
      createdAt: task.createdAt.toISOString(),
      ...base,
      text: inbound,
      toolName: null,
      toolArgs: null,
      toolOutput: null,
    });
  }
  if (outbound) {
    out.push({
      id: `task:${task.id}:agent`,
      kind: "agent_message",
      createdAt: task.updatedAt.toISOString(),
      ...base,
      text: outbound,
      toolName: null,
      toolArgs: null,
      toolOutput: null,
    });
  }
  if (out.length === 0) {
    out.push({
      id: `task:${task.id}`,
      kind: "peer_message",
      createdAt: task.createdAt.toISOString(),
      ...base,
      text: task.error
        ? String((task.error as { message?: unknown }).message ?? "failed")
        : "(empty message)",
      toolName: null,
      toolArgs: null,
      toolOutput: null,
    });
  }
  return out;
}

function buildThreads(
  entries: AgentTranscriptEntry[],
): AgentConversationThread[] {
  const byPeer = new Map<string, AgentConversationThread>();
  for (const entry of entries) {
    const existing = byPeer.get(entry.peerAgentCardUrl);
    if (!existing) {
      byPeer.set(entry.peerAgentCardUrl, {
        peerAgentCardUrl: entry.peerAgentCardUrl,
        peerDisplayName: entry.peerDisplayName,
        trustGrantId: entry.trustGrantId,
        knockId: entry.knockId,
        knockStatus: entry.kind === "knock" || entry.kind === "decision"
          ? entry.status
          : null,
        lastActivityAt: entry.createdAt,
        entryCount: 1,
      });
      continue;
    }
    existing.entryCount += 1;
    if (entry.createdAt > existing.lastActivityAt) {
      existing.lastActivityAt = entry.createdAt;
    }
    if (entry.peerDisplayName && !existing.peerDisplayName) {
      existing.peerDisplayName = entry.peerDisplayName;
    }
    if (entry.trustGrantId) existing.trustGrantId = entry.trustGrantId;
    if (entry.knockId) existing.knockId = entry.knockId;
    if (entry.kind === "decision" || entry.kind === "knock") {
      existing.knockStatus = entry.status;
    }
  }
  return [...byPeer.values()].sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : -1,
  );
}

export async function buildAgentTranscript(input: {
  agentId: string;
  tenantId: string;
  peerAgentCardUrl?: string;
}): Promise<AgentTranscriptResponse> {
  const knockRows = await db
    .select()
    .from(knocks)
    .where(
      and(
        eq(knocks.agentId, input.agentId),
        eq(knocks.tenantId, input.tenantId),
        ...(input.peerAgentCardUrl
          ? [eq(knocks.peerAgentCardUrl, input.peerAgentCardUrl)]
          : []),
      ),
    )
    .orderBy(desc(knocks.createdAt));

  const grantRows = await db
    .select()
    .from(trustGrants)
    .where(
      and(
        eq(trustGrants.agentId, input.agentId),
        eq(trustGrants.tenantId, input.tenantId),
        ...(input.peerAgentCardUrl
          ? [eq(trustGrants.peerAgentCardUrl, input.peerAgentCardUrl)]
          : []),
      ),
    );
  const grantsById = new Map(grantRows.map((g) => [g.id, g]));

  const taskRows = await db
    .select()
    .from(a2aTasks)
    .where(
      and(
        eq(a2aTasks.agentId, input.agentId),
        eq(a2aTasks.tenantId, input.tenantId),
      ),
    )
    .orderBy(desc(a2aTasks.createdAt));

  const peerGrantIds = input.peerAgentCardUrl
    ? new Set(
        grantRows
          .filter((g) => g.peerAgentCardUrl === input.peerAgentCardUrl)
          .map((g) => g.id),
      )
    : null;

  const entries: AgentTranscriptEntry[] = [];
  for (const knock of knockRows) {
    entries.push(...entriesFromKnock(knock));
  }
  for (const task of taskRows) {
    // Knock lifecycle is represented via knocks rows; skip duplicate knock tasks.
    if (task.knockId) continue;
    if (!task.trustGrantId) continue;
    if (peerGrantIds && !peerGrantIds.has(task.trustGrantId)) continue;
    entries.push(
      ...entriesFromHostedTask(task, grantsById.get(task.trustGrantId)),
    );
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const threads = buildThreads(entries);
  const filteredEntries = input.peerAgentCardUrl
    ? entries.filter((e) => e.peerAgentCardUrl === input.peerAgentCardUrl)
    : entries;

  return { threads, entries: filteredEntries };
}
