import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { chatSettings, db, secrets } from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  ChatLlmProviderSchema,
  ChatReasoningEffortSchema,
  ChatReasoningSummarySchema,
  getConfig,
  internalMcpUrl,
  JACKLINE_CHAT_SYSTEM_KEY,
  JacklineError,
  LLM_API_KEY_KIND,
  maskSecretLast4,
  type PublicChatSession,
  type PublicChatSettings,
  type UpdateChatSettingsBody,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";
import { listEffectiveTools } from "../connections/effectiveTools.js";
import { ensureJacklineChatConnection } from "./ensure.js";

export type ChatActor = {
  userId: string;
  role: string;
};

const CHAT_NOT_CONFIGURED =
  "Chat is not configured; a full admin must set provider and API key in Settings";

function isFullAdmin(role: string): boolean {
  return role === "full_admin";
}

async function loadLlmSecret(
  tenantId: string,
): Promise<Result<string | null, JacklineError>> {
  const [row] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.kind, LLM_API_KEY_KIND),
        isNull(secrets.serverId),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);
  if (!row) return ok(null);

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);
  const aad = secretAad({
    tenantId,
    kind: row.kind,
    serverId: null,
    userId: null,
    connectionId: null,
  });
  const decrypted = boxResult.value.decrypt(
    {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.keyVersion,
    },
    aad,
  );
  if (decrypted.isErr()) return err(decrypted.error);
  return ok(new TextDecoder().decode(decrypted.value));
}

async function upsertLlmSecret(
  tenantId: string,
  apiKey: string,
): Promise<Result<void, JacklineError>> {
  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);
  const aad = secretAad({
    tenantId,
    kind: LLM_API_KEY_KIND,
    serverId: null,
    userId: null,
    connectionId: null,
  });
  const encrypted = boxResult.value.encrypt(new TextEncoder().encode(apiKey), aad);
  if (encrypted.isErr()) return err(encrypted.error);

  const [existing] = await db
    .select({ id: secrets.id })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.kind, LLM_API_KEY_KIND),
        isNull(secrets.serverId),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  try {
    if (existing) {
      await db
        .update(secrets)
        .set({
          ciphertext: encrypted.value.ciphertext,
          nonce: encrypted.value.nonce,
          keyVersion: encrypted.value.keyVersion,
          updatedAt: new Date(),
        })
        .where(eq(secrets.id, existing.id));
      return ok(undefined);
    }
    await db.insert(secrets).values({
      kind: LLM_API_KEY_KIND,
      name: "Chat LLM API key",
      ciphertext: encrypted.value.ciphertext,
      nonce: encrypted.value.nonce,
      keyVersion: encrypted.value.keyVersion,
      meta: {},
      serverId: null,
      userId: null,
      connectionId: null,
      tenantId,
    });
    return ok(undefined);
  } catch (cause) {
    return err(fromDbWriteError(cause, "LLM API key already stored"));
  }
}

async function getSettings(
  log: Logger,
  tenantId: string,
): Promise<Result<PublicChatSettings, JacklineError>> {
  const [row] = await db
    .select()
    .from(chatSettings)
    .where(eq(chatSettings.tenantId, tenantId))
    .limit(1);
  const key = await loadLlmSecret(tenantId);
  if (key.isErr()) return err(key.error);

  const apiKeySet = key.value != null && key.value.length > 0;
  log.debug({ tenantId, configured: Boolean(row) && apiKeySet }, "Chat.services.getSettings");

  if (!row) {
    return ok({
      configured: false,
      provider: null,
      model: null,
      baseUrl: null,
      baseUrlSet: false,
      apiKeySet,
      apiKeyMasked: apiKeySet && key.value ? maskSecretLast4(key.value) : null,
      reasoningEffort: null,
      reasoningSummary: null,
    });
  }

  const providerParse = ChatLlmProviderSchema.safeParse(row.provider);
  const effortParse = ChatReasoningEffortSchema.safeParse(row.reasoningEffort);
  const summaryParse = ChatReasoningSummarySchema.safeParse(row.reasoningSummary);
  const provider = providerParse.success ? providerParse.data : null;
  const needsApiKey = provider !== "ollama";
  const needsBaseUrl = provider === "ollama" || provider === "openai_compatible";
  const configured =
    provider != null &&
    row.model.trim().length > 0 &&
    (!needsApiKey || apiKeySet) &&
    (!needsBaseUrl || Boolean(row.baseUrl?.trim()));

  return ok({
    configured,
    provider,
    model: row.model,
    baseUrl: row.baseUrl,
    baseUrlSet: Boolean(row.baseUrl),
    apiKeySet,
    apiKeyMasked: apiKeySet && key.value ? maskSecretLast4(key.value) : null,
    reasoningEffort: effortParse.success ? effortParse.data : null,
    reasoningSummary: summaryParse.success ? summaryParse.data : null,
  });
}

async function updateSettings(
  log: Logger,
  tenantId: string,
  actor: ChatActor,
  body: UpdateChatSettingsBody,
): Promise<Result<PublicChatSettings, JacklineError>> {
  if (!isFullAdmin(actor.role)) {
    return err(new ForbiddenError("full_admin role required"));
  }

  const existingKey = await loadLlmSecret(tenantId);
  if (existingKey.isErr()) return err(existingKey.error);
  const nextKey = body.apiKey?.trim() || existingKey.value;
  const needsApiKey = body.provider !== "ollama";
  if (needsApiKey && !nextKey) {
    return err(new BadRequestError("API key is required"));
  }
  if (nextKey) {
    const secretResult = await upsertLlmSecret(tenantId, nextKey);
    if (secretResult.isErr()) return err(secretResult.error);
  }

  try {
    const [existing] = await db
      .select({ id: chatSettings.id })
      .from(chatSettings)
      .where(eq(chatSettings.tenantId, tenantId))
      .limit(1);

    const values = {
      provider: body.provider,
      model: body.model.trim(),
      baseUrl: body.baseUrl?.trim() || null,
      reasoningEffort: body.reasoningEffort ?? null,
      reasoningSummary: body.reasoningSummary ?? null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(chatSettings)
        .set(values)
        .where(eq(chatSettings.id, existing.id));
    } else {
      await db.insert(chatSettings).values({
        tenantId,
        ...values,
      });
    }
  } catch (cause) {
    return err(fromDbWriteError(cause, "Chat settings already exist"));
  }

  log.info({ tenantId, provider: body.provider }, "Chat.services.updateSettings");
  return getSettings(log, tenantId);
}

async function getSession(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<PublicChatSession, JacklineError>> {
  const binding = await ensureJacklineChatConnection(log, tenantId, userId);
  if (binding.isErr()) return err(binding.error);

  const toolsResult = await listEffectiveTools(
    log,
    tenantId,
    binding.value.connection.id,
  );
  if (toolsResult.isErr()) return err(toolsResult.error);

  const settings = await getSettings(log, tenantId);
  if (settings.isErr()) return err(settings.error);

  return ok({
    clientId: binding.value.client.id,
    connectionId: binding.value.connection.id,
    connectionStatus: binding.value.connection.status,
    tools: toolsResult.value
      .filter((t) => t.allowed)
      .map((t) => ({
        mcpName: t.mcpName,
        serverName: t.serverName,
        allowed: t.allowed,
      })),
    llm: {
      configured: settings.value.configured,
      provider: settings.value.provider,
      model: settings.value.model,
    },
  });
}

export type ResolvedChatRun = {
  mcpUrl: string;
  gatewayToken: string;
  adapterInput: {
    provider: NonNullable<PublicChatSettings["provider"]>;
    model: string;
    apiKey: string;
    baseUrl: string | null;
    reasoningEffort: PublicChatSettings["reasoningEffort"];
    reasoningSummary: PublicChatSettings["reasoningSummary"];
  };
};

async function resolveRun(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<ResolvedChatRun, JacklineError>> {
  const binding = await ensureJacklineChatConnection(log, tenantId, userId);
  if (binding.isErr()) return err(binding.error);

  const settings = await getSettings(log, tenantId);
  if (settings.isErr()) return err(settings.error);
  if (!settings.value.configured || !settings.value.provider || !settings.value.model) {
    return err(new BadRequestError(CHAT_NOT_CONFIGURED));
  }

  const apiKey = await loadLlmSecret(tenantId);
  if (apiKey.isErr()) return err(apiKey.error);
  const needsApiKey = settings.value.provider !== "ollama";
  if (needsApiKey && !apiKey.value) {
    return err(new BadRequestError(CHAT_NOT_CONFIGURED));
  }

  const configResult = getConfig();
  if (configResult.isErr()) return err(configResult.error);

  log.info(
    {
      tenantId,
      connectionId: binding.value.connection.id,
      systemKey: JACKLINE_CHAT_SYSTEM_KEY,
      provider: settings.value.provider,
    },
    "Chat.services.resolveRun",
  );

  return ok({
    mcpUrl: internalMcpUrl(configResult.value),
    gatewayToken: binding.value.gatewayToken,
    adapterInput: {
      provider: settings.value.provider,
      model: settings.value.model,
      apiKey: apiKey.value ?? "not-required",
      baseUrl: settings.value.baseUrl,
      reasoningEffort: settings.value.reasoningEffort,
      reasoningSummary: settings.value.reasoningSummary,
    },
  });
}

export const chatServices = {
  getSettings,
  updateSettings,
  getSession,
  resolveRun,
} as const;

export { CHAT_NOT_CONFIGURED };
