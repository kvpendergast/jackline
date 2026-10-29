import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  generateMcpAccessToken,
  generateMcpAuthorizationCode,
  generateMcpRefreshToken,
  hashToken,
} from "@jackline/auth";
import {
  clients,
  connections,
  db,
  oauthAccessTokens,
  oauthAuthorizationCodes,
  tenants,
  type Client as ClientRow,
  type Connection,
} from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  getConfig,
  isCimdClientId,
  isSingleTenancy,
  JacklineError,
  JACKLINE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  JACKLINE_MCP_AUTH_CODE_TTL_SECONDS,
  mcpOauthAuthorizeUrl,
  mcpOauthIssuerUrl,
  mcpOauthRegisterUrl,
  mcpOauthTokenUrl,
  NotFoundError,
  publicApiBaseUrl,
  publicMcpUrl,
  SetupError,
  UnauthorizedError,
  validateCimdMetadata,
  validateDcrRegistrationBody,
} from "@jackline/shared";
import { verifyPkceS256 } from "./pkce.js";

export { verifyPkceS256 } from "./pkce.js";


export type AsMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  client_id_metadata_document_supported: true;
};

export function buildAsMetadata(): Result<AsMetadata, JacklineError> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);
  const issuer = mcpOauthIssuerUrl(publicApiBaseUrl(config.value));
  return ok({
    issuer,
    authorization_endpoint: mcpOauthAuthorizeUrl(issuer),
    token_endpoint: mcpOauthTokenUrl(issuer),
    registration_endpoint: mcpOauthRegisterUrl(issuer),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
    client_id_metadata_document_supported: true,
  });
}

async function resolveTenantId(
  tenantSlug: string | undefined,
): Promise<Result<{ tenantId: string; slug: string }, JacklineError>> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);

  const single = isSingleTenancy(config.value.JACKLINE_TENANCY);
  if (single.isOk() && single.value) {
    const rows = await db.select().from(tenants).limit(2);
    if (rows.length === 0) {
      return err(new SetupError("No tenant configured"));
    }
    if (rows.length > 1) {
      return err(
        new SetupError("Single tenancy expected exactly one tenant"),
      );
    }
    const tenant = rows[0]!;
    return ok({ tenantId: tenant.id, slug: tenant.slug });
  }

  if (!tenantSlug?.trim()) {
    return err(
      new BadRequestError(
        "tenant slug is required (body.tenant or query tenant)",
      ),
    );
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug.trim()))
    .limit(1);

  if (!tenant) {
    return err(new NotFoundError("Tenant not found"));
  }

  return ok({ tenantId: tenant.id, slug: tenant.slug });
}

/**
 * Fetch CIMD metadata and upsert an interactive client (registrationType=cimd).
 */
export async function resolveCimdClient(
  log: Logger,
  tenantId: string,
  metadataUrl: string,
): Promise<Result<ClientRow, JacklineError>> {
  if (!isCimdClientId(metadataUrl)) {
    return err(new BadRequestError("client_id must be an https URL for CIMD"));
  }

  let response: Response;
  try {
    response = await fetch(metadataUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    log.warn({ err: cause, metadataUrl }, "CIMD fetch failed");
    return err(new BadRequestError("Failed to fetch client metadata document"));
  }

  if (!response.ok) {
    return err(
      new BadRequestError(
        `Client metadata document returned HTTP ${response.status}`,
      ),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err(new BadRequestError("Client metadata document is not JSON"));
  }

  const validated = validateCimdMetadata(metadataUrl, body);
  if (!validated.ok) {
    return err(new BadRequestError(validated.error));
  }

  const { metadata } = validated;
  const name =
    metadata.client_name?.trim() ||
    `CIMD ${new URL(metadataUrl).hostname}`;
  const now = new Date();

  const [existing] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        eq(clients.oauthClientId, metadataUrl),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(clients)
      .set({
        name,
        redirectUris: metadata.redirect_uris,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method ?? "none",
        applicationType: metadata.application_type ?? null,
        metadataUrl,
        registrationType: "cimd",
        kind: "interactive",
        updatedAt: now,
      })
      .where(eq(clients.id, existing.id))
      .returning();
    if (!updated) {
      return err(new SetupError("Failed to update CIMD client"));
    }
    log.info({ clientId: updated.id, metadataUrl }, "mcpOauth.cimd.upsert");
    return ok(updated);
  }

  try {
    const [row] = await db
      .insert(clients)
      .values({
        name,
        kind: "interactive",
        tenantId,
        registrationType: "cimd",
        redirectUris: metadata.redirect_uris,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method ?? "none",
        applicationType: metadata.application_type ?? null,
        metadataUrl,
        oauthClientId: metadataUrl,
      })
      .returning();
    if (!row) {
      return err(new SetupError("Failed to create CIMD client"));
    }
    log.info({ clientId: row.id, metadataUrl }, "mcpOauth.cimd.create");
    return ok(row);
  } catch (cause) {
    log.warn({ err: cause, metadataUrl }, "mcpOauth.cimd.create failed");
    return err(new BadRequestError("Failed to register CIMD client"));
  }
}

async function findClientByOauthId(
  tenantId: string,
  oauthClientId: string,
): Promise<ClientRow | null> {
  // Prefer oauthClientId match (CIMD URL / DCR id), then row UUID.
  const [byOauth] = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.tenantId, tenantId),
        eq(clients.oauthClientId, oauthClientId),
      ),
    )
    .limit(1);
  if (byOauth) return byOauth;

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(oauthClientId)) return null;

  const [byId] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, oauthClientId), eq(clients.tenantId, tenantId)))
    .limit(1);
  return byId ?? null;
}

/**
 * Resolve the OAuth client for authorize/token. CIMD URLs are fetched+upserted.
 * For multi-tenant, tenantSlug is required when client is not yet known.
 */
export async function resolveOauthClient(
  log: Logger,
  clientId: string,
  tenantSlug: string | undefined,
): Promise<Result<ClientRow, JacklineError>> {
  if (isCimdClientId(clientId)) {
    const tenant = await resolveTenantId(tenantSlug);
    if (tenant.isErr()) return err(tenant.error);
    return resolveCimdClient(log, tenant.value.tenantId, clientId);
  }

  // Known client by oauthClientId or UUID across tenants (UUID is globally unique).
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidRe.test(clientId)) {
    const [byId] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (byId) return ok(byId);
  }

  const [byOauth] = await db
    .select()
    .from(clients)
    .where(eq(clients.oauthClientId, clientId))
    .limit(2);

  if (byOauth) {
    // If multiple tenants could share DCR ids, scope by tenant slug.
    const all = await db
      .select()
      .from(clients)
      .where(eq(clients.oauthClientId, clientId));
    if (all.length === 1) return ok(all[0]!);
    if (tenantSlug) {
      const tenant = await resolveTenantId(tenantSlug);
      if (tenant.isErr()) return err(tenant.error);
      const match = all.find((c) => c.tenantId === tenant.value.tenantId);
      if (match) return ok(match);
    }
    return err(new BadRequestError("Ambiguous client_id; provide tenant"));
  }

  // Last resort: resolve tenant then look up
  const tenant = await resolveTenantId(tenantSlug);
  if (tenant.isErr()) return err(tenant.error);
  const found = await findClientByOauthId(tenant.value.tenantId, clientId);
  if (!found) {
    return err(new UnauthorizedError("Unknown client_id"));
  }
  return ok(found);
}

export async function ensureConnection(
  tenantId: string,
  clientId: string,
  userId: string,
): Promise<Result<Connection, JacklineError>> {
  const [existing] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.tenantId, tenantId),
        eq(connections.clientId, clientId),
        eq(connections.userId, userId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status !== "active") {
      const [activated] = await db
        .update(connections)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(connections.id, existing.id))
        .returning();
      if (!activated) {
        return err(new SetupError("Failed to activate connection"));
      }
      return ok(activated);
    }
    return ok(existing);
  }

  try {
    const [row] = await db
      .insert(connections)
      .values({
        tenantId,
        clientId,
        userId,
        status: "active",
      })
      .returning();
    if (!row) {
      return err(new SetupError("Failed to create connection"));
    }
    return ok(row);
  } catch {
    const [retry] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.tenantId, tenantId),
          eq(connections.clientId, clientId),
          eq(connections.userId, userId),
        ),
      )
      .limit(1);
    if (retry) return ok(retry);
    return err(new SetupError("Failed to create connection"));
  }
}

export type AuthorizeQuery = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state?: string | undefined;
  code_challenge: string;
  code_challenge_method: string;
  resource?: string | undefined;
  scope?: string | undefined;
  tenant?: string | undefined;
};

export async function validateAuthorizeRequest(
  log: Logger,
  query: AuthorizeQuery,
): Promise<
  Result<
    {
      client: ClientRow;
      redirectUri: string;
      resource: string;
      scopes: string;
      codeChallenge: string;
    },
    JacklineError
  >
> {
  if (query.response_type !== "code") {
    return err(new BadRequestError("response_type must be code"));
  }
  if (query.code_challenge_method !== "S256") {
    return err(new BadRequestError("code_challenge_method must be S256"));
  }
  if (!query.code_challenge?.trim()) {
    return err(new BadRequestError("code_challenge is required"));
  }

  const config = getConfig();
  if (config.isErr()) return err(config.error);
  const expectedResource = publicMcpUrl(config.value);

  const resource = (query.resource ?? expectedResource).replace(/\/$/, "");
  if (resource !== expectedResource.replace(/\/$/, "")) {
    return err(
      new BadRequestError(
        `resource must be ${expectedResource}`,
      ),
    );
  }

  const clientResult = await resolveOauthClient(
    log,
    query.client_id,
    query.tenant,
  );
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  if (client.kind !== "interactive") {
    return err(new BadRequestError("Only interactive clients can authorize"));
  }

  const redirectUris = client.redirectUris ?? [];
  if (!redirectUris.includes(query.redirect_uri)) {
    return err(new BadRequestError("redirect_uri is not registered"));
  }

  return ok({
    client,
    redirectUri: query.redirect_uri,
    resource,
    scopes: query.scope?.trim() || "mcp",
    codeChallenge: query.code_challenge,
  });
}

export async function createAuthorizationCode(
  log: Logger,
  input: {
    client: ClientRow;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    resource: string;
    scopes: string;
  },
): Promise<Result<{ code: string; connectionId: string }, JacklineError>> {
  const connection = await ensureConnection(
    input.client.tenantId,
    input.client.id,
    input.userId,
  );
  if (connection.isErr()) return err(connection.error);

  const code = generateMcpAuthorizationCode();
  const expiresAt = new Date(
    Date.now() + JACKLINE_MCP_AUTH_CODE_TTL_SECONDS * 1000,
  );

  const [row] = await db
    .insert(oauthAuthorizationCodes)
    .values({
      codeHash: hashToken(code),
      clientId: input.client.id,
      tenantId: input.client.tenantId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      resource: input.resource,
      scopes: input.scopes,
      expiresAt,
      connectionId: connection.value.id,
    })
    .returning();

  if (!row) {
    return err(new SetupError("Failed to create authorization code"));
  }

  log.info(
    {
      clientId: input.client.id,
      connectionId: connection.value.id,
      userId: input.userId,
    },
    "mcpOauth.authorize.code",
  );

  return ok({ code, connectionId: connection.value.id });
}

export type DcrResult = {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: string[];
  response_types: string[];
  application_type: "native" | "web";
  client_name?: string | undefined;
  registration_access_token: string;
};

/**
 * RFC 7591 Dynamic Client Registration.
 * @deprecated Prefer CIMD (client_id metadata documents). Kept for Grok compatibility.
 */
export async function registerDcrClient(
  log: Logger,
  body: unknown,
  tenantSlugFromQuery: string | undefined,
): Promise<Result<DcrResult, JacklineError>> {
  const validated = validateDcrRegistrationBody(body);
  if (!validated.ok) {
    return err(new BadRequestError(validated.error));
  }

  const reg = validated.value;
  const tenant = await resolveTenantId(reg.tenant ?? tenantSlugFromQuery);
  if (tenant.isErr()) return err(tenant.error);

  const oauthClientId = `dcr_${randomBytes(16).toString("hex")}`;
  const registrationAccessToken = `jackline_rat_${randomBytes(24).toString("base64url")}`;
  const applicationType = reg.application_type ?? "native";
  const name = reg.client_name?.trim() || `DCR ${oauthClientId.slice(0, 12)}`;
  const grantTypes = reg.grant_types ?? ["authorization_code", "refresh_token"];
  const responseTypes = reg.response_types ?? ["code"];

  try {
    const [row] = await db
      .insert(clients)
      .values({
        name,
        kind: "interactive",
        tenantId: tenant.value.tenantId,
        registrationType: "dcr",
        redirectUris: reg.redirect_uris,
        tokenEndpointAuthMethod: "none",
        applicationType,
        oauthClientId,
        dcrRegistrationAccessTokenHash: hashToken(registrationAccessToken),
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to register client"));
    }

    log.info(
      { clientId: row.id, oauthClientId, tenantId: tenant.value.tenantId },
      "mcpOauth.dcr.register",
    );

    return ok({
      client_id: oauthClientId,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      redirect_uris: reg.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: grantTypes,
      response_types: responseTypes,
      application_type: applicationType,
      client_name: reg.client_name,
      registration_access_token: registrationAccessToken,
    });
  } catch (cause) {
    log.warn({ err: cause }, "mcpOauth.dcr.register failed");
    return err(new BadRequestError("Failed to register client"));
  }
}

export type McpTokenResult = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

async function issueMcpTokens(
  log: Logger,
  input: {
    client: ClientRow;
    userId: string;
    connectionId: string;
    audience: string;
    scopes: string;
    grantType: "authorization_code" | "refresh_token";
  },
): Promise<Result<McpTokenResult, JacklineError>> {
  const accessToken = generateMcpAccessToken();
  const refreshToken = generateMcpRefreshToken();
  const expiresIn = JACKLINE_MCP_ACCESS_TOKEN_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const [row] = await db
    .insert(oauthAccessTokens)
    .values({
      tokenHash: hashToken(accessToken),
      clientId: input.client.id,
      tenantId: input.client.tenantId,
      userId: input.userId,
      expiresAt,
      grantType: input.grantType,
      audience: input.audience,
      connectionId: input.connectionId,
      refreshTokenHash: hashToken(refreshToken),
      scopes: input.scopes,
    })
    .returning();

  if (!row) {
    return err(new SetupError("Failed to issue MCP access token"));
  }

  log.info(
    {
      clientId: input.client.id,
      connectionId: input.connectionId,
      grantType: input.grantType,
    },
    "mcpOauth.token.issue",
  );

  return ok({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: input.scopes,
  });
}

export async function exchangeAuthorizationCode(
  log: Logger,
  params: {
    code: string;
    client_id: string;
    redirect_uri: string;
    code_verifier: string;
    resource?: string | undefined;
    tenant?: string | undefined;
  },
): Promise<Result<McpTokenResult, JacklineError>> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);
  const expectedResource = publicMcpUrl(config.value).replace(/\/$/, "");
  const resource = (params.resource ?? expectedResource).replace(/\/$/, "");
  if (resource !== expectedResource) {
    return err(new BadRequestError(`resource must be ${expectedResource}`));
  }

  const clientResult = await resolveOauthClient(
    log,
    params.client_id,
    params.tenant,
  );
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  const codeHash = hashToken(params.code);
  const [authCode] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, codeHash))
    .limit(1);

  if (!authCode || authCode.clientId !== client.id) {
    return err(new UnauthorizedError("Invalid authorization code"));
  }
  if (authCode.usedAt) {
    return err(new UnauthorizedError("Authorization code already used"));
  }
  if (authCode.expiresAt.getTime() < Date.now()) {
    return err(new UnauthorizedError("Authorization code expired"));
  }
  if (authCode.redirectUri !== params.redirect_uri) {
    return err(new BadRequestError("redirect_uri mismatch"));
  }
  if (authCode.resource.replace(/\/$/, "") !== resource) {
    return err(new BadRequestError("resource mismatch"));
  }
  if (authCode.codeChallengeMethod !== "S256") {
    return err(new BadRequestError("Unsupported code_challenge_method"));
  }
  if (!verifyPkceS256(params.code_verifier, authCode.codeChallenge)) {
    return err(new UnauthorizedError("PKCE verification failed"));
  }

  const now = new Date();
  const [marked] = await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthAuthorizationCodes.id, authCode.id),
        isNull(oauthAuthorizationCodes.usedAt),
      ),
    )
    .returning();

  if (!marked) {
    return err(new UnauthorizedError("Authorization code already used"));
  }

  let connectionId = authCode.connectionId;
  if (!connectionId) {
    const connection = await ensureConnection(
      client.tenantId,
      client.id,
      authCode.userId,
    );
    if (connection.isErr()) return err(connection.error);
    connectionId = connection.value.id;
  }

  return issueMcpTokens(log, {
    client,
    userId: authCode.userId,
    connectionId,
    audience: resource,
    scopes: authCode.scopes || "mcp",
    grantType: "authorization_code",
  });
}

export async function exchangeRefreshToken(
  log: Logger,
  params: {
    refresh_token: string;
    client_id: string;
    resource?: string | undefined;
    tenant?: string | undefined;
  },
): Promise<Result<McpTokenResult, JacklineError>> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);
  const expectedResource = publicMcpUrl(config.value).replace(/\/$/, "");
  const resource = (params.resource ?? expectedResource).replace(/\/$/, "");
  if (resource !== expectedResource) {
    return err(new BadRequestError(`resource must be ${expectedResource}`));
  }

  const clientResult = await resolveOauthClient(
    log,
    params.client_id,
    params.tenant,
  );
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  const refreshHash = hashToken(params.refresh_token);
  const [existing] = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.refreshTokenHash, refreshHash))
    .limit(1);

  if (
    !existing ||
    existing.clientId !== client.id ||
    existing.revokedAt ||
    !existing.connectionId
  ) {
    return err(new UnauthorizedError("Invalid refresh token"));
  }

  if ((existing.audience ?? "").replace(/\/$/, "") !== resource) {
    return err(new BadRequestError("resource mismatch"));
  }

  const [connection] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, existing.connectionId))
    .limit(1);

  if (!connection || connection.status !== "active") {
    return err(new ForbiddenError("Connection is not active"));
  }

  const now = new Date();
  await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(oauthAccessTokens.id, existing.id));

  return issueMcpTokens(log, {
    client,
    userId: existing.userId,
    connectionId: existing.connectionId,
    audience: resource,
    scopes: existing.scopes || "mcp",
    grantType: "refresh_token",
  });
}

export const mcpOauthServices = {
  buildAsMetadata,
  registerDcrClient,
  validateAuthorizeRequest,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  resolveOauthClient,
  ensureConnection,
} as const;
