import z from "zod";

export const AgentTranscriptKindSchema = z.enum([
  "knock",
  "decision",
  "peer_message",
  "agent_message",
  "tool_call",
]);

export const AgentTranscriptEntrySchema = z.strictObject({
  id: z.string(),
  kind: AgentTranscriptKindSchema,
  createdAt: z.iso.datetime(),
  peerAgentCardUrl: z.string().url(),
  peerDisplayName: z.string().nullable(),
  knockId: z.uuid().nullable(),
  trustGrantId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  /** Peer inbound or agent outbound text when applicable. */
  text: z.string().nullable(),
  /** Knock/decision status when kind is knock or decision. */
  status: z.string().nullable(),
  decisionNote: z.string().nullable(),
  toolName: z.string().nullable(),
  toolArgs: z.unknown().nullable(),
  toolOutput: z.unknown().nullable(),
  taskState: z.string().nullable(),
});

export const AgentConversationThreadSchema = z.strictObject({
  peerAgentCardUrl: z.string().url(),
  peerDisplayName: z.string().nullable(),
  trustGrantId: z.uuid().nullable(),
  knockId: z.uuid().nullable(),
  knockStatus: z.string().nullable(),
  lastActivityAt: z.iso.datetime(),
  entryCount: z.number().int().nonnegative(),
});

export const AgentTranscriptResponseSchema = z.strictObject({
  threads: z.array(AgentConversationThreadSchema),
  entries: z.array(AgentTranscriptEntrySchema),
});

export type AgentTranscriptKind = z.infer<typeof AgentTranscriptKindSchema>;
export type AgentTranscriptEntry = z.infer<typeof AgentTranscriptEntrySchema>;
export type AgentConversationThread = z.infer<
  typeof AgentConversationThreadSchema
>;
export type AgentTranscriptResponse = z.infer<
  typeof AgentTranscriptResponseSchema
>;
