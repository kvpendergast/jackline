import z from "zod";

export const JACKLINE_CHAT_SYSTEM_KEY = "jackline_chat" as const;
export const JACKLINE_CHAT_CLIENT_NAME = "Jackline Chat" as const;
export const LLM_API_KEY_KIND = "llm_api_key" as const;

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

export type PublicChatSession = z.infer<typeof PublicChatSessionSchema>;
export type PublicChatSettings = z.infer<typeof PublicChatSettingsSchema>;
export type UpdateChatSettingsBody = z.infer<
  typeof UpdateChatSettingsBodySchema
>;

export function maskSecretLast4(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
