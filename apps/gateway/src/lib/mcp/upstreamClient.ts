import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { db, secrets, servers, type Secret as SecretRow } from "@jackline/db";
import {
  BadRequestError,
  getConfig,
  isInvalidUpstreamTokenError,
  JacklineError,
  NotFoundError,
  NotImplementedError,
  resolveOAuthAccessToken,
  upstreamCredentialFailure,
  upstreamSecretKind,
  type UpstreamCredentialFailureError,
} from "@jackline/shared";
import { getSecretBox, secretAad } from "../secretBox.js";

export type UpstreamServerRow = {
  id: string;
  name: string;
  baseUrl: string;
  authMethod: "api_key" | "oauth" | "mtls";
  credentialMode: "shared" | "subject_required" | "either";
  kind: "mcp" | "api";
  status: string;
};

function webOrigin(): string {
  const config = getConfig();
  return config.isOk() ? config.value.WEB_ORIGIN : "http://127.0.0.1:5173";
}

export { isInvalidUpstreamTokenError };

function personalCredentialError(
  server: Pick<UpstreamServerRow, "id" | "name">,
  kind: "missing_personal" | "expired_personal",
): UpstreamCredentialFailureError {
  return upstreamCredentialFailure({
    webOrigin: webOrigin(),
    serverId: server.id,
    serverName: server.name,
    kind,
  });
}

function sharedCredentialError(
  server: Pick<UpstreamServerRow, "id" | "name">,
  kind: "missing_shared" | "expired_shared",
): UpstreamCredentialFailureError {
  return upstreamCredentialFailure({
    webOrigin: webOrigin(),
    serverId: server.id,
    serverName: server.name,
    kind,
  });
}

/**
 * Raise MCP URL elicitation so Cursor / other harnesses can open My Access.
 * Falls back to a plain Forbidden-style message when reconnect URL is missing.
 */
export function throwUpstreamUrlElicitation(
  error: UpstreamCredentialFailureError,
): never {
  if (!error.requiresUrlElicitation || !error.reconnectUrl) {
    throw error;
  }
  throw new UrlElicitationRequiredError(
    [
      {
        mode: "url",
        elicitationId: randomUUID(),
        url: error.reconnectUrl,
        message: error.message,
      },
    ],
    error.message,
  );
}

async function loadUpstreamSecret(
  log: Logger,
  tenantId: string,
  server: UpstreamServerRow,
  userId: string,
): Promise<Result<SecretRow, JacklineError>> {
  const { id: serverId, authMethod, credentialMode } = server;

  if (authMethod === "mtls") {
    return err(new NotImplementedError("Upstream mTLS auth is not supported yet"));
  }

  const kind = upstreamSecretKind(authMethod);

  async function loadUserSecret() {
    const [userSecret] = await db
      .select()
      .from(secrets)
      .where(
        and(
          eq(secrets.tenantId, tenantId),
          eq(secrets.serverId, serverId),
          eq(secrets.userId, userId),
          eq(secrets.kind, kind),
          isNull(secrets.connectionId),
        ),
      )
      .limit(1);
    return userSecret ?? null;
  }

  async function loadServerSecret() {
    const [serverSecret] = await db
      .select()
      .from(secrets)
      .where(
        and(
          eq(secrets.tenantId, tenantId),
          eq(secrets.serverId, serverId),
          eq(secrets.kind, kind),
          isNull(secrets.userId),
          isNull(secrets.connectionId),
        ),
      )
      .limit(1);
    return serverSecret ?? null;
  }

  if (credentialMode === "shared") {
    const serverSecret = await loadServerSecret();
    if (!serverSecret) {
      return err(sharedCredentialError(server, "missing_shared"));
    }
    log.debug({ serverId, kind }, "using server-level upstream secret");
    return ok(serverSecret);
  }

  if (credentialMode === "subject_required") {
    const userSecret = await loadUserSecret();
    if (!userSecret) {
      return err(personalCredentialError(server, "missing_personal"));
    }
    log.debug({ serverId, userId, kind }, "using per-user upstream secret");
    return ok(userSecret);
  }

  const userSecret = await loadUserSecret();
  if (userSecret) {
    log.debug({ serverId, userId, kind }, "using per-user upstream secret");
    return ok(userSecret);
  }

  const serverSecret = await loadServerSecret();
  if (!serverSecret) {
    return err(personalCredentialError(server, "missing_personal"));
  }

  log.debug({ serverId, kind }, "using server-level upstream secret");
  return ok(serverSecret);
}

function decryptSecret(row: SecretRow): Result<string, JacklineError> {
  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId: row.tenantId,
    kind: row.kind,
    serverId: row.serverId,
    userId: row.userId,
    connectionId: row.connectionId,
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

async function persistSecretPlaintext(
  log: Logger,
  row: SecretRow,
  plaintext: string,
): Promise<void> {
  const boxResult = getSecretBox();
  if (boxResult.isErr()) {
    log.warn(
      { err: boxResult.error, secretId: row.id },
      "oauth refresh: secret box unavailable; token used in-memory only",
    );
    return;
  }

  const aad = secretAad({
    tenantId: row.tenantId,
    kind: row.kind,
    serverId: row.serverId,
    userId: row.userId,
    connectionId: row.connectionId,
  });

  const encrypted = boxResult.value.encrypt(
    new TextEncoder().encode(plaintext),
    aad,
  );
  if (encrypted.isErr()) {
    log.warn(
      { err: encrypted.error, secretId: row.id },
      "oauth refresh: encrypt failed; token used in-memory only",
    );
    return;
  }

  try {
    await db
      .update(secrets)
      .set({
        ciphertext: encrypted.value.ciphertext,
        nonce: encrypted.value.nonce,
        keyVersion: encrypted.value.keyVersion,
        updatedAt: new Date(),
      })
      .where(eq(secrets.id, row.id));
    log.debug({ secretId: row.id }, "persisted refreshed upstream OAuth secret");
  } catch (cause) {
    log.warn(
      { err: cause, secretId: row.id },
      "oauth refresh: persist failed; token used in-memory only",
    );
  }
}

async function bearerFromPlaintext(
  log: Logger,
  server: UpstreamServerRow,
  secretRow: SecretRow,
  plaintext: string,
  options?: { forceRefresh?: boolean },
): Promise<Result<string, JacklineError>> {
  if (server.authMethod === "api_key") {
    return ok(plaintext);
  }

  if (server.authMethod === "oauth") {
    const token = await resolveOAuthAccessToken(
      plaintext,
      options?.forceRefresh ? { forceRefresh: true } : undefined,
    );
    if (token.isErr()) {
      const personal = secretRow.userId != null;
      return err(
        personal
          ? personalCredentialError(server, "expired_personal")
          : sharedCredentialError(server, "expired_shared"),
      );
    }
    if (token.value.updatedPlaintext) {
      await persistSecretPlaintext(log, secretRow, token.value.updatedPlaintext);
    }
    return ok(token.value.accessToken);
  }

  return err(
    new NotImplementedError(
      `Upstream auth method "${server.authMethod}" is not supported yet`,
    ),
  );
}

/**
 * Resolve Authorization headers for an upstream server (MCP or HTTP API).
 */
export async function resolveUpstreamAuthHeaders(
  log: Logger,
  tenantId: string,
  userId: string,
  server: UpstreamServerRow,
  options?: { forceRefresh?: boolean },
): Promise<Result<Record<string, string>, JacklineError>> {
  if (server.status !== "active") {
    return err(new BadRequestError(`Server is ${server.status}`));
  }

  const secretRow = await loadUpstreamSecret(log, tenantId, server, userId);
  if (secretRow.isErr()) return err(secretRow.error);

  const plaintext = decryptSecret(secretRow.value);
  if (plaintext.isErr()) return err(plaintext.error);

  const bearer = await bearerFromPlaintext(
    log,
    server,
    secretRow.value,
    plaintext.value,
    options,
  );
  if (bearer.isErr()) return err(bearer.error);

  return ok({ Authorization: `Bearer ${bearer.value}` });
}

export function formatUpstreamError(
  cause: unknown,
  phase: "connect" | "list" | "call",
): JacklineError {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "unknown error";

  const prefix =
    phase === "connect"
      ? "Upstream MCP connection failed"
      : phase === "list"
        ? "Upstream tools/list failed"
        : "Upstream tool call failed";

  return new JacklineError("INTERNAL", `${prefix}: ${detail}`);
}

export type ConnectedUpstream = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close: () => Promise<void>;
};

async function openUpstream(
  server: UpstreamServerRow,
  headers: Record<string, string>,
): Promise<Result<ConnectedUpstream, JacklineError>> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(server.baseUrl);
  } catch {
    return err(new BadRequestError(`Invalid server baseUrl: ${server.baseUrl}`));
  }

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    requestInit: { headers },
  });
  const client = new Client({ name: "jackline-gateway", version: "0.0.0" });

  try {
    await client.connect(transport as unknown as Transport);
  } catch (cause) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    return err(formatUpstreamError(cause, "connect"));
  }

  return ok({
    client,
    transport,
    close: async () => {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    },
  });
}

/**
 * Open a short-lived MCP client to an upstream MCP server.
 * On invalid_token / unauthorized, force-refresh OAuth once and retry.
 */
export async function connectUpstream(
  log: Logger,
  tenantId: string,
  userId: string,
  server: UpstreamServerRow,
): Promise<Result<ConnectedUpstream, JacklineError>> {
  if (server.kind !== "mcp") {
    return err(
      new NotImplementedError(
        `Server kind "${server.kind}" is not an MCP upstream`,
      ),
    );
  }

  const headers = await resolveUpstreamAuthHeaders(log, tenantId, userId, server);
  if (headers.isErr()) return err(headers.error);

  const first = await openUpstream(server, headers.value);
  if (first.isOk()) return first;

  if (
    server.authMethod !== "oauth" ||
    !isInvalidUpstreamTokenError(first.error.message)
  ) {
    return first;
  }

  log.info(
    { serverId: server.id },
    "upstream MCP auth failed; force-refreshing OAuth and retrying connect",
  );

  const refreshed = await resolveUpstreamAuthHeaders(
    log,
    tenantId,
    userId,
    server,
    { forceRefresh: true },
  );
  if (refreshed.isErr()) return err(refreshed.error);

  if (
    refreshed.value["Authorization"] === headers.value["Authorization"]
  ) {
    return first;
  }

  return openUpstream(server, refreshed.value);
}

export async function loadUpstreamServer(
  tenantId: string,
  serverId: string,
): Promise<Result<UpstreamServerRow, JacklineError>> {
  const [row] = await db
    .select({
      id: servers.id,
      name: servers.name,
      baseUrl: servers.baseUrl,
      authMethod: servers.authMethod,
      credentialMode: servers.credentialMode,
      kind: servers.kind,
      status: servers.status,
    })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError(`Server ${serverId} not found`));
  }

  return ok(row);
}
