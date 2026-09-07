import { eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  createEmailConnector,
  formatFromAddress,
  verificationEmail,
  type OutboundEmail,
  type ResolvedEmailConnectorConfig,
} from "@jackline/email";
import { db, platformEmailSettings } from "@jackline/db";
import {
  BadRequestError,
  EmailConnectorKeySchema,
  EmailNotConfiguredError,
  getConfig,
  getEmailConnectorPreset,
  JacklineError,
  PLATFORM_EMAIL_API_KEY_AAD,
  SetupError,
  type PublicEmailDeliveryStatus,
  type PublicPlatformEmailSettings,
  type UpdatePlatformEmailSettingsBody,
} from "@jackline/shared";
import { getSecretBox } from "../../lib/secrets/secretBox.js";

const LOCAL_KEY_VERSION = 1;

type ResolvedPlatformEmail = {
  public: PublicPlatformEmailSettings;
  runtime: ResolvedEmailConnectorConfig;
};

async function ensureSettingsRow() {
  const [existing] = await db.select().from(platformEmailSettings).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(platformEmailSettings)
    .values({ connectorKey: "console" })
    .returning();
  if (!created) throw new SetupError("Failed to create platform email settings");
  return created;
}

function decryptApiKey(
  row: typeof platformEmailSettings.$inferSelect,
): string | null {
  if (
    !row.apiKeyCiphertext ||
    !row.apiKeyNonce ||
    row.apiKeyKeyVersion == null
  ) {
    return null;
  }

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return null;
  const decrypted = boxResult.value.decrypt(
    {
      ciphertext: row.apiKeyCiphertext,
      nonce: row.apiKeyNonce,
      keyVersion: row.apiKeyKeyVersion,
    },
    new TextEncoder().encode(PLATFORM_EMAIL_API_KEY_AAD),
  );
  if (decrypted.isErr()) return null;
  return new TextDecoder().decode(decrypted.value);
}

function isDeliveryReady(runtime: ResolvedEmailConnectorConfig): boolean {
  if (!runtime.fromEmail || runtime.fromEmail === "noreply@localhost") {
    return false;
  }
  if (runtime.connectorKey === "resend") {
    return Boolean(runtime.apiKey);
  }
  if (runtime.connectorKey === "smtp") {
    return Boolean(runtime.smtpHost);
  }
  return false;
}

function toPublic(
  runtime: ResolvedEmailConnectorConfig,
  extras: {
    fromEmail: string | null;
    fromName: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean;
    smtpUser: string | null;
    hasApiKey: boolean;
    source: PublicPlatformEmailSettings["source"];
    updatedAt: string;
  },
): PublicPlatformEmailSettings {
  const deliveryReady = isDeliveryReady(runtime);
  const connectorParse = EmailConnectorKeySchema.safeParse(runtime.connectorKey);
  return {
    connectorKey: connectorParse.success ? connectorParse.data : "console",
    fromEmail: extras.fromEmail,
    fromName: extras.fromName,
    smtpHost: extras.smtpHost,
    smtpPort: extras.smtpPort,
    smtpSecure: extras.smtpSecure,
    smtpUser: extras.smtpUser,
    hasApiKey: extras.hasApiKey,
    deliveryReady,
    configured: deliveryReady,
    source: extras.source,
    updatedAt: extras.updatedAt,
  };
}

function rowHasSavedConfig(row: typeof platformEmailSettings.$inferSelect): boolean {
  return (
    row.connectorKey !== "console" ||
    row.fromEmail != null ||
    row.apiKeyCiphertext != null ||
    row.smtpHost != null
  );
}

function resolveFromEnv(): ResolvedPlatformEmail | null {
  const configResult = getConfig();
  if (configResult.isErr()) return null;
  const env = configResult.value;

  const connectorKey = env.EMAIL_CONNECTOR;
  const fromEmail = env.EMAIL_FROM ?? null;
  const hasCredentials =
    (connectorKey === "resend" && Boolean(env.RESEND_API_KEY)) ||
    (connectorKey === "smtp" && Boolean(env.SMTP_HOST));

  if (!hasCredentials && connectorKey === "console" && !fromEmail) {
    return null;
  }

  const runtime: ResolvedEmailConnectorConfig = {
    connectorKey,
    fromEmail: fromEmail ?? "noreply@localhost",
    fromName: null,
    apiKey: env.RESEND_API_KEY ?? null,
    smtpHost: env.SMTP_HOST ?? null,
    smtpPort: env.SMTP_PORT ?? null,
    smtpSecure: env.SMTP_SECURE,
    smtpUser: env.SMTP_USER ?? null,
    smtpPass: env.SMTP_PASS ?? null,
  };

  return {
    public: toPublic(runtime, {
      fromEmail,
      fromName: null,
      smtpHost: env.SMTP_HOST ?? null,
      smtpPort: env.SMTP_PORT ?? null,
      smtpSecure: env.SMTP_SECURE,
      smtpUser: env.SMTP_USER ?? null,
      hasApiKey: Boolean(env.RESEND_API_KEY || env.SMTP_PASS),
      source: "environment",
      updatedAt: new Date(0).toISOString(),
    }),
    runtime,
  };
}

async function resolvePlatformEmail(): Promise<ResolvedPlatformEmail> {
  const row = await ensureSettingsRow();

  if (rowHasSavedConfig(row)) {
    const connectorParse = EmailConnectorKeySchema.safeParse(row.connectorKey);
    const connectorKey = connectorParse.success ? connectorParse.data : "console";
    const secret = decryptApiKey(row);

    const runtime: ResolvedEmailConnectorConfig = {
      connectorKey,
      fromEmail: row.fromEmail ?? "noreply@localhost",
      fromName: row.fromName,
      apiKey: connectorKey === "resend" ? secret : null,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      smtpUser: row.smtpUser,
      smtpPass: connectorKey === "smtp" ? secret : null,
    };

    return {
      public: toPublic(runtime, {
        fromEmail: row.fromEmail,
        fromName: row.fromName,
        smtpHost: row.smtpHost,
        smtpPort: row.smtpPort,
        smtpSecure: row.smtpSecure,
        smtpUser: row.smtpUser,
        hasApiKey: secret != null,
        source: "database",
        updatedAt: row.updatedAt.toISOString(),
      }),
      runtime,
    };
  }

  const fromEnv = resolveFromEnv();
  if (fromEnv) return fromEnv;

  const runtime: ResolvedEmailConnectorConfig = {
    connectorKey: "console",
    fromEmail: "noreply@localhost",
    fromName: null,
  };

  return {
    public: toPublic(runtime, {
      fromEmail: null,
      fromName: null,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: false,
      smtpUser: null,
      hasApiKey: false,
      source: "default",
      updatedAt: row.updatedAt.toISOString(),
    }),
    runtime,
  };
}

async function getStatus(
  log: Logger,
): Promise<Result<PublicEmailDeliveryStatus, JacklineError>> {
  const resolved = await resolvePlatformEmail();
  log.debug(
    {
      deliveryReady: resolved.public.deliveryReady,
      connectorKey: resolved.public.connectorKey,
    },
    "getEmailDeliveryStatus",
  );
  return ok({
    deliveryReady: resolved.public.deliveryReady,
    connectorKey: resolved.public.connectorKey,
  });
}

async function get(
  log: Logger,
): Promise<Result<PublicPlatformEmailSettings, JacklineError>> {
  const resolved = await resolvePlatformEmail();
  log.debug(
    { connectorKey: resolved.public.connectorKey, source: resolved.public.source },
    "getPlatformEmailSettings",
  );
  return ok(resolved.public);
}

async function update(
  log: Logger,
  input: UpdatePlatformEmailSettingsBody,
): Promise<Result<PublicPlatformEmailSettings, JacklineError>> {
  const existing = await ensureSettingsRow();
  const patch: Partial<typeof platformEmailSettings.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (input.connectorKey !== undefined) patch.connectorKey = input.connectorKey;
  if (input.fromEmail !== undefined) patch.fromEmail = input.fromEmail;
  if (input.fromName !== undefined) patch.fromName = input.fromName || null;
  if (input.smtpHost !== undefined) patch.smtpHost = input.smtpHost;
  if (input.smtpPort !== undefined) patch.smtpPort = input.smtpPort;
  if (input.smtpSecure !== undefined) patch.smtpSecure = input.smtpSecure;
  if (input.smtpUser !== undefined) patch.smtpUser = input.smtpUser || null;

  const connectorKey =
    input.connectorKey ??
    EmailConnectorKeySchema.safeParse(existing.connectorKey).data ??
    "console";
  const preset = getEmailConnectorPreset(connectorKey);

  if (input.clearApiKey) {
    patch.apiKeyCiphertext = null;
    patch.apiKeyNonce = null;
    patch.apiKeyKeyVersion = null;
  }

  const secretValue = input.apiKey ?? input.smtpPass;
  if (secretValue !== undefined) {
    const boxResult = getSecretBox();
    if (boxResult.isErr()) return err(boxResult.error);
    const encrypted = boxResult.value.encrypt(
      new TextEncoder().encode(secretValue),
      new TextEncoder().encode(PLATFORM_EMAIL_API_KEY_AAD),
    );
    if (encrypted.isErr()) return err(encrypted.error);
    patch.apiKeyCiphertext = encrypted.value.ciphertext;
    patch.apiKeyNonce = encrypted.value.nonce;
    patch.apiKeyKeyVersion = LOCAL_KEY_VERSION;
  }

  const nextFromEmail = input.fromEmail ?? existing.fromEmail;
  if (preset?.requiresApiKey && connectorKey !== "console") {
    const willHaveKey =
      secretValue !== undefined ||
      input.clearApiKey !== true && existing.apiKeyCiphertext != null;
    if (!willHaveKey) {
      return err(new BadRequestError("API key is required for this connector"));
    }
  }
  if (preset?.requiresSmtpHost) {
    const nextHost = input.smtpHost ?? existing.smtpHost;
    if (!nextHost) {
      return err(new BadRequestError("SMTP host is required for this connector"));
    }
  }
  if (connectorKey !== "console" && !nextFromEmail) {
    return err(new BadRequestError("From email is required"));
  }

  const [row] = await db
    .update(platformEmailSettings)
    .set(patch)
    .where(eq(platformEmailSettings.id, existing.id))
    .returning();
  if (!row) return err(new SetupError("Failed to update platform email settings"));

  log.info({ connectorKey: row.connectorKey }, "platform email settings updated");
  const resolved = await resolvePlatformEmail();
  return ok(resolved.public);
}

async function send(
  log: Logger,
  message: OutboundEmail,
): Promise<Result<void, JacklineError>> {
  try {
    const resolved = await resolvePlatformEmail();
    if (!resolved.public.deliveryReady) {
      return err(new EmailNotConfiguredError());
    }
    const connector = createEmailConnector(resolved.runtime);
    await connector.send(message);
    log.debug(
      { connectorKey: resolved.runtime.connectorKey, to: message.to },
      "platform email sent",
    );
    return ok(undefined);
  } catch (cause) {
    if (cause instanceof JacklineError) {
      return err(cause);
    }
    const messageText =
      cause instanceof Error ? cause.message : "Failed to send email";
    log.warn({ err: cause }, "platform email send failed");
    return err(new SetupError(messageText));
  }
}

async function sendVerification(
  log: Logger,
  to: string,
  url: string,
): Promise<Result<void, JacklineError>> {
  const resolved = await resolvePlatformEmail();
  const from = formatFromAddress(
    resolved.runtime.fromEmail,
    resolved.runtime.fromName,
  );
  return send(log, verificationEmail({ from, to, url }));
}

export const platformEmailServices = {
  get,
  getStatus,
  update,
  send,
  sendVerification,
} as const;
