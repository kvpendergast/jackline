import z from "zod";

export const JACKLINE_CHAT_SYSTEM_KEY = "jackline_chat" as const;
export const JACKLINE_CHAT_CLIENT_NAME = "Jackline Chat" as const;
export const LLM_API_KEY_KIND = "llm_api_key" as const;

export const CHAT_NOT_CONFIGURED =
  "Chat is not configured; a full admin must set provider and API key in Settings";

export const ChatLlmProviderSchema = z.enum([
  "openrouter",
  "openai",
  "anthropic",
  "ollama",
  "openai_compatible",
]);

export type ChatLlmProvider = z.infer<typeof ChatLlmProviderSchema>;

export const ChatReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
]);

export const ChatReasoningSummarySchema = z.enum(["auto", "detailed"]);

export const PublicChatSessionSchema = z.strictObject({
  clientId: z.uuid(),
  connectionId: z.uuid(),
  connectionStatus: z.string(),
  tools: z.array(
    z.strictObject({
      mcpName: z.string(),
      serverName: z.string(),
      allowed: z.boolean(),
    }),
  ),
  llm: z.strictObject({
    configured: z.boolean(),
    provider: ChatLlmProviderSchema.nullable(),
    model: z.string().nullable(),
  }),
});

export const PublicChatSettingsSchema = z.strictObject({
  configured: z.boolean(),
  provider: ChatLlmProviderSchema.nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  baseUrlSet: z.boolean(),
  apiKeySet: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  reasoningEffort: ChatReasoningEffortSchema.nullable(),
  reasoningSummary: ChatReasoningSummarySchema.nullable(),
});

export const UpdateChatSettingsBodySchema = z
  .strictObject({
    provider: ChatLlmProviderSchema,
    model: z.string().min(1),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().min(1).nullable().optional(),
    reasoningEffort: ChatReasoningEffortSchema.nullable().optional(),
    reasoningSummary: ChatReasoningSummarySchema.nullable().optional(),
  })
  .superRefine((body, ctx) => {
    if (
      (body.provider === "ollama" || body.provider === "openai_compatible") &&
      (body.baseUrl == null || body.baseUrl.trim() === "")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "baseUrl is required for this provider",
        path: ["baseUrl"],
      });
    }
  });

export const DEFAULT_CHAT_THREAD_TITLE = "New chat";
export const CHAT_THREAD_TITLE_MAX = 80;

export const ChatUiMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.unknown()),
  })
  .passthrough();

export const PublicChatThreadSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  lastMessageAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PublicChatThreadSchema = PublicChatThreadSummarySchema.extend({
  messages: z.array(z.unknown()),
});

export const UpdateChatThreadBodySchema = z
  .strictObject({
    messages: z.array(ChatUiMessageSchema).optional(),
    title: z.string().min(1).max(CHAT_THREAD_TITLE_MAX).optional(),
  })
  .refine((body) => body.messages !== undefined || body.title !== undefined, {
    message: "messages or title is required",
  });

export type PublicChatSession = z.infer<typeof PublicChatSessionSchema>;
export type PublicChatSettings = z.infer<typeof PublicChatSettingsSchema>;
export type UpdateChatSettingsBody = z.infer<
  typeof UpdateChatSettingsBodySchema
>;
export type PublicChatThreadSummary = z.infer<
  typeof PublicChatThreadSummarySchema
>;
export type PublicChatThread = z.infer<typeof PublicChatThreadSchema>;
export type UpdateChatThreadBody = z.infer<typeof UpdateChatThreadBodySchema>;
export type ChatUiMessage = z.infer<typeof ChatUiMessageSchema>;

export function titleFromChatMessages(messages: unknown[]): string | null {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const row = message as { role?: unknown; parts?: unknown };
    if (row.role !== "user" || !Array.isArray(row.parts)) continue;
    for (const part of row.parts) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: unknown; content?: unknown };
      if (typed.type !== "text" || typeof typed.content !== "string") continue;
      const trimmed = typed.content.replace(/\s+/g, " ").trim();
      if (!trimmed) continue;
      return trimmed.length > CHAT_THREAD_TITLE_MAX
        ? `${trimmed.slice(0, CHAT_THREAD_TITLE_MAX - 1).trimEnd()}…`
        : trimmed;
    }
  }
  return null;
}

export function maskSecretLast4(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
