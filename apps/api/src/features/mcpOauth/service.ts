import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  hashToken,
  generateMcpOauthAccessToken,
  generateMcpOauthAuthorizationCode,
  generateMcpOauthClientSecret,
  generateMcpOauthRefreshToken,
} from "@jackline/auth";
import {
  connections,
  db,
  mcpOauthAccessTokens,
  mcpOauthAuthorizationCodes,
  mcpOauthClients,
  mcpOauthRefreshTokens,
  type Connection as ConnectionRow,
  type McpOauthClient,
} from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  JacklineError,
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_AUTH_CODE_TTL_SECONDS,
  MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  NotFoundError,
  UnauthorizedError,
  getConfig,
  isRedirectUriAllowed,
  publicMcpUrl,
  resolveMcpOauthRedirectUris,
  type CreateMcpOauthClientBody,
  type MintedMcpOauthClient,
  type PublicMcpOauthClient,
  type UpdateMcpOauthClientRedirectsBody,
} from "@jackline/shared";
import {
  isAdminRole,
  type ActorAuthz,
} from "../../lib/authz/teamScope.js";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function toPublic(row: McpOauthClient): PublicMcpOauthClient {
  return {
    id: row.id,
    name: row.name,
    connectionId: row.connectionId,
    tenantId: row.tenantId,
    redirectUris: row.redirectUris,
    hasClientSecret: Boolean(row.clientSecretHash),
    clientSecretRotatedAt: row.clientSecretRotatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mintedPayload(
  row: McpOauthClient,
  clientSecret: string,
): MintedMcpOauthClient {
  const config = getConfig();
  if (config.isErr()) throw config.error;
  const mcpUrl = publicMcpUrl(config.value);
  const pub = toPublic(row);
  return {
    ...pub,
    clientId: row.id,
    clientSecret,
    mcp: {
      url: mcpUrl,
      cursor: {
        auth: {
          CLIENT_ID: row.id,
          CLIENT_SECRET: clientSecret,
        },
      },
      claudeCode: {
        type: "http",
        oauth: {
          clientId: row.id,
        },
      },
    },
  };
}

async function requireConnection(
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
): Promise<Result<ConnectionRow, JacklineError>> {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, connectionId),
        eq(connections.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!row) return err(new NotFoundError("Connection not found"));
  if (!isAdminRole(actor.role) && row.userId !== actor.userId) {
    return err(new ForbiddenError("Not allowed to manage this connection"));
  }
  return ok(row);
}

async function createClient(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  input: CreateMcpOauthClientBody,
): Promise<Result<MintedMcpOauthClient, JacklineError>> {
  const connectionResult = await requireConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const urisResult = resolveMcpOauthRedirectUris({
    redirectPresets: input.redirectPresets,
    redirectUris: input.redirectUris,
  });
  if (urisResult.isErr()) return err(urisResult.error);

  const clientSecret = generateMcpOauthClientSecret();
  const clientSecretHash = hashToken(clientSecret);

  try {
    const [row] = await db
      .insert(mcpOauthClients)
      .values({
        name: input.name.trim(),
        tenantId,
        connectionId,
        clientSecretHash,
        clientSecretRotatedAt: new Date(),
        redirectUris: urisResult.value,
        createdByUserId: actor.userId,
      })
      .returning();
    if (!row) return err(new BadRequestError("Failed to create MCP OAuth client"));

    log.info(
      { tenantId, connectionId, clientId: row.id },
      "McpOauth.services.createClient",
    );
    return ok(mintedPayload(row, clientSecret));
  } catch (cause) {
    return err(
      fromDbWriteError(
        cause,
        "An MCP OAuth client with this name already exists on the connection",
      ),
    );
  }
}

async function listClients(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
): Promise<Result<PublicMcpOauthClient[], JacklineError>> {
  const connectionResult = await requireConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const rows = await db
    .select()
    .from(mcpOauthClients)
    .where(
      and(
        eq(mcpOauthClients.tenantId, tenantId),
        eq(mcpOauthClients.connectionId, connectionId),
      ),
    )
    .orderBy(desc(mcpOauthClients.createdAt), desc(mcpOauthClients.id));

  log.debug(
    { tenantId, connectionId, count: rows.length },
    "McpOauth.services.listClients",
  );
  return ok(rows.map(toPublic));
}

async function getClient(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  clientId: string,
): Promise<Result<PublicMcpOauthClient, JacklineError>> {
  const connectionResult = await requireConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const [row] = await db
    .select()
    .from(mcpOauthClients)
    .where(
      and(
        eq(mcpOauthClients.id, clientId),
        eq(mcpOauthClients.tenantId, tenantId),
        eq(mcpOauthClients.connectionId, connectionId),
      ),
    )
    .limit(1);
  if (!row) return err(new NotFoundError("MCP OAuth client not found"));
  log.debug({ clientId }, "McpOauth.services.getClient");
  return ok(toPublic(row));
}

async function updateRedirects(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  clientId: string,
  input: UpdateMcpOauthClientRedirectsBody,
): Promise<Result<PublicMcpOauthClient, JacklineError>> {
  const existing = await getClient(log, tenantId, actor, connectionId, clientId);
  if (existing.isErr()) return err(existing.error);

  const urisResult = resolveMcpOauthRedirectUris({
    redirectPresets: input.redirectPresets,
    redirectUris:
      input.redirectUris ??
      (input.redirectPresets ? [] : existing.value.redirectUris),
  });
  if (urisResult.isErr()) return err(urisResult.error);

  const [row] = await db
    .update(mcpOauthClients)
    .set({
      redirectUris: urisResult.value,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpOauthClients.id, clientId),
        eq(mcpOauthClients.tenantId, tenantId),
        eq(mcpOauthClients.connectionId, connectionId),
      ),
    )
    .returning();
  if (!row) return err(new NotFoundError("MCP OAuth client not found"));
  log.info({ clientId }, "McpOauth.services.updateRedirects");
  return ok(toPublic(row));
}

async function rotateClientSecret(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  clientId: string,
): Promise<Result<MintedMcpOauthClient, JacklineError>> {
  const connectionResult = await requireConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const clientSecret = generateMcpOauthClientSecret();
  const [row] = await db
    .update(mcpOauthClients)
    .set({
      clientSecretHash: hashToken(clientSecret),
      clientSecretRotatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpOauthClients.id, clientId),
        eq(mcpOauthClients.tenantId, tenantId),
        eq(mcpOauthClients.connectionId, connectionId),
        isNull(mcpOauthClients.revokedAt),
      ),
    )
    .returning();
  if (!row) return err(new NotFoundError("MCP OAuth client not found"));

  // Rotating the client secret invalidates outstanding refresh sessions.
  const revoked = await revokeClientSessions(
    log,
    tenantId,
    actor,
    connectionId,
    clientId,
  );
  if (revoked.isErr()) return err(revoked.error);

  log.info({ clientId }, "McpOauth.services.rotateClientSecret");
  return ok(mintedPayload(row, clientSecret));
}

async function revokeClient(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  clientId: string,
): Promise<Result<PublicMcpOauthClient, JacklineError>> {
  const connectionResult = await requireConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const now = new Date();
  const [row] = await db
    .update(mcpOauthClients)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(mcpOauthClients.id, clientId),
        eq(mcpOauthClients.tenantId, tenantId),
        eq(mcpOauthClients.connectionId, connectionId),
        isNull(mcpOauthClients.revokedAt),
      ),
    )
    .returning();
  if (!row) return err(new NotFoundError("MCP OAuth client not found"));

  const revoked = await revokeClientSessions(
    log,
    tenantId,
    actor,
    connectionId,
    clientId,
  );
  if (revoked.isErr()) return err(revoked.error);
  log.info({ clientId }, "McpOauth.services.revokeClient");
  return ok(toPublic(row));
}

async function revokeClientSessions(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  clientId: string,
): Promise<Result<{ revokedRefreshTokens: number; revokedAccessTokens: number }, JacklineError>> {
  const connectionResult = await requireConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const now = new Date();
  const refresh = await db
    .update(mcpOauthRefreshTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(mcpOauthRefreshTokens.clientId, clientId),
        eq(mcpOauthRefreshTokens.tenantId, tenantId),
        eq(mcpOauthRefreshTokens.connectionId, connectionId),
        isNull(mcpOauthRefreshTokens.revokedAt),
      ),
    )
    .returning({ id: mcpOauthRefreshTokens.id });

  const access = await db
    .update(mcpOauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(mcpOauthAccessTokens.clientId, clientId),
        eq(mcpOauthAccessTokens.tenantId, tenantId),
        eq(mcpOauthAccessTokens.connectionId, connectionId),
        isNull(mcpOauthAccessTokens.revokedAt),
      ),
    )
    .returning({ id: mcpOauthAccessTokens.id });

  log.info(
    {
      clientId,
      revokedRefreshTokens: refresh.length,
      revokedAccessTokens: access.length,
    },
    "McpOauth.services.revokeClientSessions",
  );
  return ok({
    revokedRefreshTokens: refresh.length,
    revokedAccessTokens: access.length,
  });
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return safeEqualString(digest, codeChallenge);
}

async function loadActiveClient(
  clientId: string,
): Promise<Result<McpOauthClient, JacklineError>> {
  const [row] = await db
    .select()
    .from(mcpOauthClients)
    .where(and(eq(mcpOauthClients.id, clientId), isNull(mcpOauthClients.revokedAt)))
    .limit(1);
  if (!row) return err(new UnauthorizedError("Invalid client"));
  return ok(row);
}

async function authenticateClient(
  clientId: string,
  clientSecret: string,
): Promise<Result<McpOauthClient, JacklineError>> {
  const clientResult = await loadActiveClient(clientId);
  if (clientResult.isErr()) return err(clientResult.error);
  const expected = clientResult.value.clientSecretHash;
  if (!safeEqualString(hashToken(clientSecret), expected)) {
    return err(new UnauthorizedError("Invalid client"));
  }
  return clientResult;
}

async function issueAuthorizationCode(
  log: Logger,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope?: string | undefined;
    state?: string | undefined;
  },
): Promise<Result<{ code: string; redirectUri: string; state?: string }, JacklineError>> {
  const clientResult = await loadActiveClient(input.clientId);
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  if (input.codeChallengeMethod !== "S256") {
    return err(new BadRequestError("Only code_challenge_method=S256 is supported"));
  }
  if (!isRedirectUriAllowed(input.redirectUri, client.redirectUris)) {
    return err(new BadRequestError("redirect_uri is not allowed for this client"));
  }

  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, client.connectionId),
        eq(connections.tenantId, client.tenantId),
      ),
    )
    .limit(1);
  if (!connection || connection.status !== "active") {
    return err(new ForbiddenError("Connection is not active"));
  }
  // Consenting user must own the connection (or we allow any signed-in user for
  // admin-managed connections later — for now: owner only).
  if (connection.userId !== input.userId) {
    return err(
      new ForbiddenError(
        "Signed-in user is not the owner of this MCP connection",
      ),
    );
  }

  const code = generateMcpOauthAuthorizationCode();
  const expiresAt = new Date(
    Date.now() + MCP_OAUTH_AUTH_CODE_TTL_SECONDS * 1000,
  );
  await db.insert(mcpOauthAuthorizationCodes).values({
    codeHash: hashToken(code),
    clientId: client.id,
    tenantId: client.tenantId,
    connectionId: client.connectionId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    scope: input.scope ?? "mcp",
    expiresAt,
  });

  log.info(
    { clientId: client.id, connectionId: client.connectionId, userId: input.userId },
    "McpOauth.services.issueAuthorizationCode",
  );
  return ok({
    code,
    redirectUri: input.redirectUri,
    ...(input.state ? { state: input.state } : {}),
  });
}

async function mintTokenPair(
  client: McpOauthClient,
  userId: string,
  scope: string | null,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const accessToken = generateMcpOauthAccessToken();
  const refreshToken = generateMcpOauthRefreshToken();
  const now = Date.now();
  const refreshExpires = new Date(
    now + MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
  );
  const accessExpires = new Date(
    now + MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  );

  const [refreshRow] = await db
    .insert(mcpOauthRefreshTokens)
    .values({
      tokenHash: hashToken(refreshToken),
      clientId: client.id,
      tenantId: client.tenantId,
      connectionId: client.connectionId,
      userId,
      scope,
      expiresAt: refreshExpires,
    })
    .returning();
  if (!refreshRow) {
    throw new Error("Failed to insert refresh token");
  }

  await db.insert(mcpOauthAccessTokens).values({
    tokenHash: hashToken(accessToken),
    clientId: client.id,
    tenantId: client.tenantId,
    connectionId: client.connectionId,
    userId,
    refreshTokenId: refreshRow.id,
    scope,
    expiresAt: accessExpires,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  };
}

async function exchangeAuthorizationCode(
  log: Logger,
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
): Promise<
  Result<
    {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string | null;
    },
    JacklineError
  >
> {
  const clientResult = await authenticateClient(
    input.clientId,
    input.clientSecret,
  );
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  const [codeRow] = await db
    .select()
    .from(mcpOauthAuthorizationCodes)
    .where(eq(mcpOauthAuthorizationCodes.codeHash, hashToken(input.code)))
    .limit(1);

  if (
    !codeRow ||
    codeRow.usedAt ||
    codeRow.expiresAt.getTime() <= Date.now() ||
    codeRow.clientId !== client.id
  ) {
    return err(new BadRequestError("Invalid authorization code"));
  }
  if (codeRow.redirectUri !== input.redirectUri) {
    return err(new BadRequestError("redirect_uri mismatch"));
  }
  if (!verifyPkce(input.codeVerifier, codeRow.codeChallenge)) {
    return err(new BadRequestError("Invalid code_verifier"));
  }

  await db
    .update(mcpOauthAuthorizationCodes)
    .set({ usedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpOauthAuthorizationCodes.id, codeRow.id));

  const pair = await mintTokenPair(client, codeRow.userId, codeRow.scope);
  log.info(
    { clientId: client.id, connectionId: client.connectionId },
    "McpOauth.services.exchangeAuthorizationCode",
  );
  return ok({
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    scope: codeRow.scope,
  });
}

async function refreshAccessToken(
  log: Logger,
  input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
): Promise<
  Result<
    {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string | null;
    },
    JacklineError
  >
> {
  const clientResult = await authenticateClient(
    input.clientId,
    input.clientSecret,
  );
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  const [refreshRow] = await db
    .select()
    .from(mcpOauthRefreshTokens)
    .where(
      and(
        eq(mcpOauthRefreshTokens.tokenHash, hashToken(input.refreshToken)),
        eq(mcpOauthRefreshTokens.clientId, client.id),
        isNull(mcpOauthRefreshTokens.revokedAt),
      ),
    )
    .limit(1);

  if (!refreshRow || refreshRow.expiresAt.getTime() <= Date.now()) {
    return err(new BadRequestError("Invalid refresh token"));
  }

  // Rotate refresh token.
  const now = new Date();
  const pair = await mintTokenPair(
    client,
    refreshRow.userId,
    refreshRow.scope,
  );

  const [newRefresh] = await db
    .select()
    .from(mcpOauthRefreshTokens)
    .where(eq(mcpOauthRefreshTokens.tokenHash, hashToken(pair.refreshToken)))
    .limit(1);

  await db
    .update(mcpOauthRefreshTokens)
    .set({
      revokedAt: now,
      replacedById: newRefresh?.id ?? null,
      updatedAt: now,
    })
    .where(eq(mcpOauthRefreshTokens.id, refreshRow.id));

  // Revoke access tokens minted from the old refresh token.
  await db
    .update(mcpOauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(mcpOauthAccessTokens.refreshTokenId, refreshRow.id),
        isNull(mcpOauthAccessTokens.revokedAt),
      ),
    );

  log.info(
    { clientId: client.id, connectionId: client.connectionId },
    "McpOauth.services.refreshAccessToken",
  );
  return ok({
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
    scope: refreshRow.scope,
  });
}

export const mcpOauthServices = {
  createClient,
  listClients,
  getClient,
  updateRedirects,
  rotateClientSecret,
  revokeClient,
  revokeClientSessions,
  issueAuthorizationCode,
  exchangeAuthorizationCode,
  refreshAccessToken,
  loadActiveClient,
};
