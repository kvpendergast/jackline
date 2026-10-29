import z from "zod";

export const AGENT_HANDLE_REGEX = /^[a-z0-9-]{3,32}$/;

export const AgentHandleSchema = z
  .string()
  .regex(AGENT_HANDLE_REGEX, "Handle must be 3-32 lowercase letters, digits, or hyphens");

export const AgentStatusSchema = z.enum(["draft", "published", "paused"]);
export const AgentRuntimeModeSchema = z.enum(["hosted", "upstream"]);

export const AgentPublicSkillSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
});

export const AGENT_INSTRUCTIONS_MAX_CHARS = 32_000;

export const PublicAgentSchema = z.strictObject({
  id: z.uuid(),
  tenantId: z.uuid(),
  ownerUserId: z.string(),
  handle: AgentHandleSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  runtimeMode: AgentRuntimeModeSchema,
  upstreamAgentUrl: z.string().url().nullable(),
  status: AgentStatusSchema,
  knocksEnabled: z.boolean(),
  defaultGrantTtlSeconds: z.number().int().positive(),
  instructions: z.string().nullable(),
  publicSkills: z.array(AgentPublicSkillSchema),
  toolIds: z.array(z.uuid()),
  agentCardUrl: z.string().url(),
  a2aUrl: z.string().url(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateAgentBodySchema = z.strictObject({
  handle: AgentHandleSchema,
  displayName: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  knocksEnabled: z.boolean().optional(),
  defaultGrantTtlSeconds: z.number().int().positive().max(60 * 60 * 24 * 365).optional(),
  instructions: z.string().max(AGENT_INSTRUCTIONS_MAX_CHARS).optional(),
  publicSkills: z.array(AgentPublicSkillSchema).optional(),
  toolIds: z.array(z.uuid()).optional(),
});

export const UpdateAgentBodySchema = z.strictObject({
  displayName: z.string().min(1).max(128).optional(),
  description: z.string().max(2000).nullable().optional(),
  knocksEnabled: z.boolean().optional(),
  defaultGrantTtlSeconds: z.number().int().positive().max(60 * 60 * 24 * 365).optional(),
  instructions: z.string().max(AGENT_INSTRUCTIONS_MAX_CHARS).nullable().optional(),
  publicSkills: z.array(AgentPublicSkillSchema).optional(),
  runtimeMode: AgentRuntimeModeSchema.optional(),
  upstreamAgentUrl: z.string().url().nullable().optional(),
});

export const SetAgentToolsBodySchema = z.strictObject({
  toolIds: z.array(z.uuid()),
});

export const PublicDirectoryAgentSchema = z.strictObject({
  handle: AgentHandleSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  publicSkills: z.array(z.string()),
  agentCardUrl: z.string().url(),
  knocksEnabled: z.boolean(),
});

export const AgentDirectoryResponseSchema = z.strictObject({
  network: z.string(),
  agents: z.array(PublicDirectoryAgentSchema),
});

export const PUBLIC_NETWORK_SLUG = "public" as const;

export const DEFAULT_PUBLIC_SKILLS: z.infer<typeof AgentPublicSkillSchema>[] = [
  {
    id: "contact.leave_message",
    name: "Leave a message",
    description: "Send a short message to the agent owner",
  },
];

export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentRuntimeMode = z.infer<typeof AgentRuntimeModeSchema>;
export type AgentPublicSkill = z.infer<typeof AgentPublicSkillSchema>;
export type PublicAgent = z.infer<typeof PublicAgentSchema>;
export type CreateAgentBody = z.infer<typeof CreateAgentBodySchema>;
export type UpdateAgentBody = z.infer<typeof UpdateAgentBodySchema>;
export type SetAgentToolsBody = z.infer<typeof SetAgentToolsBodySchema>;
export type PublicDirectoryAgent = z.infer<typeof PublicDirectoryAgentSchema>;
export type AgentDirectoryResponse = z.infer<typeof AgentDirectoryResponseSchema>;
