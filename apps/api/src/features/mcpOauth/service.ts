import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  generateApiUserAccessToken,
  generateApiUserRefreshToken,
  generateMcpAccessToken,
  generateMcpAuthorizationCode,
  generateMcpRefreshToken,
  hashToken,
} from "@jackline/auth";
import {
  clients,
  connections,
  db,
  memberships,
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
  JACKLINE_API_SCOPE,
  JACKLINE_API_USER_ACCESS_TOKEN_TTL_SECONDS,
  JACKLINE_API_USER_REFRESH_TOKEN_IDLE_TTL_SECONDS,
  JACKLINE_CLI_CLIENT_ID,
  JACKLINE_CLI_CLIENT_NAME,
  JACKLINE_CLI_REDIRECT_URIS,
  JACKLINE_CLI_SYSTEM_KEY,
  jacklineApiResource,
  JACKLINE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  JACKLINE_MCP_AUTH_CODE_TTL_SECONDS,
  mcpOauthAuthorizeUrl,
  mcpOauthIssuerUrl,
  mcpOauthRegisterUrl,
  mcpOauthRevokeUrl,
  mcpOauthTokenUrl,
  NotFoundError,
  publicApiBaseUrl,
  publicMcpUrl,
  redirectUriMatches,
  SetupError,
  UnauthorizedError,
  validateCimdMetadata,
  validateDcrRegistrationBody,
} from "@jackline/shared";
import { verifyPkceS256 } from "./pkce.js";

export { verifyPkceS256 } from "./pkce.js";

/**
 * Which resource server a token is minted for (RFC 8707 `resource`).
 * - `mcp`: the MCP gateway (connection-bound `jackline_mcp_` tokens)
 * - `api`: the Jackline REST API (user-bound `jackline_uat_` tokens, CLI login)
 */
export type TokenAudience = "mcp" | "api";

function stripSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/** Canonical resource URLs for both audiences. */
export function audienceResources(): Result<
  { mcp: string; api: string },
  JacklineError
> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);
  return ok({
    mcp: stripSlash(publicMcpUrl(config.value)),
    api: stripSlash(jacklineApiResource(publicApiBaseUrl(config.value))),
  });
}

/** Map a requested resource (or, when absent, scope) to an audience. */
export function resolveRequestedAudience(
  resourceParam: string | undefined,
  scopeParam: string | undefined,
): Result<{ audience: TokenAudience; resource: string }, JacklineError> {
  const resources = audienceResources();
  if (resources.isErr()) return err(resources.error);
  const { mcp, api } = resources.value;

  if (resourceParam?.trim()) {
    const requested = stripSlash(resourceParam.trim());
    if (requested === mcp) return ok({ audience: "mcp", resource: mcp });
    if (requested === api) return ok({ audience: "api", resource: api });
    return err(new BadRequestError(`resource must be ${mcp} or ${api}`));
  }

  const scopes = (scopeParam ?? "").split(/\s+/).filter(Boolean);
  if (scopes.includes(JACKLINE_API_SCOPE)) {
    return ok({ audience: "api", resource: api });
  }
  return ok({ audience: "mcp", resource: mcp });
}

function isCliClient(client: ClientRow): boolean {
  return client.systemKey === JACKLINE_CLI_SYSTEM_KEY;
}


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
  revocation_endpoint: string;
  revocation_endpoint_auth_methods_supported: string[];
  /** RFC 8707 resource for Jackline REST API user tokens (CLI login). */
  jackline_api_resource: string;
  /** RFC 8707 resource for MCP gateway tokens. */
  jackline_mcp_resource: string;
  /** Pre-registered public client id for `jackline login`. */
  jackline_cli_client_id: string;
  /** `multi` deployments need `tenant=<slug>` on authorize/token/revoke. */
  jackline_tenancy: "single" | "multi";
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
    scopes_supported: ["mcp", JACKLINE_API_SCOPE],
    client_id_metadata_document_supported: true,
    revocation_endpoint: mcpOauthRevokeUrl(issuer),
    revocation_endpoint_auth_methods_supported: ["none"],
    jackline_api_resource: jacklineApiResource(issuer),
    jackline_mcp_resource: stripSlash(publicMcpUrl(config.value)),
    jackline_cli_client_id: JACKLINE_CLI_CLIENT_ID,
    jackline_tenancy: config.value.JACKLINE_TENANCY,
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
 * Ensure the first-party `jackline-cli` public client exists for a tenant.
 * Pre-registered (no secret, PKCE required, loopback redirects on any port).
 */
export async function ensureCliClient(
  log: Logger,
  tenantId: string,
): Promise<Result<ClientRow, JacklineError>> {
  const find = async () => {
    const [row] = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.tenantId, tenantId),
          eq(clients.systemKey, JACKLINE_CLI_SYSTEM_KEY),
        ),
      )
      .limit(1);
    return row;
  };

  const existing = await find();
  if (existing) return ok(existing);

  try {
    const [row] = await db
      .insert(clients)
      .values({
        name: JACKLINE_CLI_CLIENT_NAME,
        kind: "interactive",
        tenantId,
        systemKey: JACKLINE_CLI_SYSTEM_KEY,
        registrationType: "pre_registered",
        redirectUris: [...JACKLINE_CLI_REDIRECT_URIS],
        tokenEndpointAuthMethod: "none",
        applicationType: "native",
        oauthClientId: JACKLINE_CLI_CLIENT_ID,
      })
      .returning();
    if (!row) return err(new SetupError("Failed to create CLI client"));
    log.info({ clientId: row.id, tenantId }, "mcpOauth.cli.client.create");
    return ok(row);
  } catch (cause) {
    // Concurrent first login (or a name clash): re-read.
    const retry = await find();
    if (retry) return ok(retry);
    log.warn({ err: cause, tenantId }, "mcpOauth.cli.client.create failed");
    return err(
      new SetupError(
        `Failed to register the ${JACKLINE_CLI_CLIENT_NAME} client for this tenant`,
      ),
    );
  }
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

  if (clientId === JACKLINE_CLI_CLIENT_ID) {
    const tenant = await resolveTenantId(tenantSlug);
    if (tenant.isErr()) return err(tenant.error);
    return ensureCliClient(log, tenant.value.tenantId);
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
      audience: TokenAudience;
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

  const requested = resolveRequestedAudience(query.resource, query.scope);
  if (requested.isErr()) return err(requested.error);
  const { audience, resource } = requested.value;

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

  // API user tokens are first-party only: third-party MCP clients (CIMD/DCR)
  // cannot obtain REST API access, and the CLI client cannot mint MCP tokens.
  if (audience === "api" && !isCliClient(client)) {
    return err(
      new BadRequestError(
        "This client may not request the Jackline API resource",
      ),
    );
  }
  if (audience === "mcp" && isCliClient(client)) {
    return err(
      new BadRequestError(
        `${JACKLINE_CLI_CLIENT_ID} may only request the Jackline API resource`,
      ),
    );
  }

  const redirectUris = client.redirectUris ?? [];
  if (!redirectUris.some((uri) => redirectUriMatches(uri, query.redirect_uri))) {
    return err(new BadRequestError("redirect_uri is not registered"));
  }

  return ok({
    client,
    redirectUri: query.redirect_uri,
    resource,
    audience,
    scopes:
      audience === "api" ? JACKLINE_API_SCOPE : query.scope?.trim() || "mcp",
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
    audience?: TokenAudience | undefined;
    scopes: string;
  },
): Promise<
  Result<{ code: string; connectionId: string | null }, JacklineError>
> {
  let connectionId: string | null = null;
  if (input.audience === "api") {
    // API tokens act as the user in the client's tenant; no MCP connection.
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, input.userId),
          eq(memberships.tenantId, input.client.tenantId),
        ),
      )
      .limit(1);
    if (!membership) {
      return err(new ForbiddenError("You are not a member of this tenant"));
    }
  } else {
    const connection = await ensureConnection(
      input.client.tenantId,
      input.client.id,
      input.userId,
    );
    if (connection.isErr()) return err(connection.error);
    connectionId = connection.value.id;
  }

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
      connectionId,
    })
    .returning();

  if (!row) {
    return err(new SetupError("Failed to create authorization code"));
  }

  log.info(
    {
      clientId: input.client.id,
      connectionId,
      userId: input.userId,
      audience: input.audience ?? "mcp",
    },
    "mcpOauth.authorize.code",
  );

  return ok({ code, connectionId });
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

/**
 * Mint a short-lived Jackline API user access token + rotating refresh token.
 * Not connection-bound; the API resolves membership (role) at every request.
 */
async function issueApiUserTokens(
  log: Logger,
  input: {
    client: ClientRow;
    userId: string;
    audience: string;
    grantType: "authorization_code" | "refresh_token";
  },
): Promise<Result<McpTokenResult, JacklineError>> {
  const accessToken = generateApiUserAccessToken();
  const refreshToken = generateApiUserRefreshToken();
  const expiresIn = JACKLINE_API_USER_ACCESS_TOKEN_TTL_SECONDS;
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
      connectionId: null,
      refreshTokenHash: hashToken(refreshToken),
      scopes: JACKLINE_API_SCOPE,
    })
    .returning();

  if (!row) {
    return err(new SetupError("Failed to issue API access token"));
  }

  log.info(
    {
      clientId: input.client.id,
      userId: input.userId,
      grantType: input.grantType,
      audience: "api",
    },
    "mcpOauth.token.issue",
  );

  return ok({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope: JACKLINE_API_SCOPE,
  });
}

/**
 * Resolve the token-endpoint `resource`: optional, but when present it must be
 * a known resource and equal the one bound at authorize / original issue.
 */
function resolveBoundResource(
  requested: string | undefined,
  bound: string,
): Result<{ audience: TokenAudience; resource: string }, JacklineError> {
  const resources = audienceResources();
  if (resources.isErr()) return err(resources.error);
  const { mcp, api } = resources.value;
  const boundNorm = stripSlash(bound);
  const resource = requested?.trim() ? stripSlash(requested.trim()) : boundNorm;
  if (resource !== mcp && resource !== api) {
    return err(new BadRequestError(`resource must be ${mcp} or ${api}`));
  }
  if (resource !== boundNorm) {
    return err(new BadRequestError("resource mismatch"));
  }
  return ok({ audience: resource === api ? "api" : "mcp", resource });
}

async function hasMembership(userId: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .limit(1);
  return Boolean(row);
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
  const bound = resolveBoundResource(params.resource, authCode.resource);
  if (bound.isErr()) return err(bound.error);
  const { audience, resource } = bound.value;
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

  if (audience === "api") {
    if (!isCliClient(client)) {
      return err(new UnauthorizedError("Invalid authorization code"));
    }
    return issueApiUserTokens(log, {
      client,
      userId: authCode.userId,
      audience: resource,
      grantType: "authorization_code",
    });
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

  if (!existing || existing.clientId !== client.id) {
    return err(new UnauthorizedError("Invalid refresh token"));
  }

  if (existing.audience === null) {
    // client_credentials rows never carry refresh tokens.
    return err(new UnauthorizedError("Invalid refresh token"));
  }
  const bound = resolveBoundResource(params.resource, existing.audience);
  if (bound.isErr()) return err(bound.error);
  const { audience, resource } = bound.value;

  if (audience === "api") {
    return rotateApiUserRefreshToken(log, { client, existing, resource });
  }

  if (existing.revokedAt || !existing.connectionId) {
    return err(new UnauthorizedError("Invalid refresh token"));
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

async function rotateApiUserRefreshToken(
  log: Logger,
  input: {
    client: ClientRow;
    existing: typeof oauthAccessTokens.$inferSelect;
    resource: string;
  },
): Promise<Result<McpTokenResult, JacklineError>> {
  const { client, existing, resource } = input;
  const now = new Date();

  if (existing.revokedAt) {
    // Refresh token reuse (RFC 9700 §4.14.2): a rotated-out token came back.
    // Treat the login as compromised and revoke every live API token this
    // client holds for the user.
    await db
      .update(oauthAccessTokens)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(oauthAccessTokens.clientId, client.id),
          eq(oauthAccessTokens.userId, existing.userId),
          eq(oauthAccessTokens.audience, existing.audience ?? resource),
          isNull(oauthAccessTokens.revokedAt),
        ),
      );
    log.warn(
      { clientId: client.id, userId: existing.userId },
      "mcpOauth.refresh.reuse_detected",
    );
    return err(new UnauthorizedError("Invalid refresh token"));
  }

  const idleDeadline =
    existing.createdAt.getTime() +
    JACKLINE_API_USER_REFRESH_TOKEN_IDLE_TTL_SECONDS * 1000;
  if (idleDeadline <= now.getTime()) {
    return err(new UnauthorizedError("Refresh token expired"));
  }

  if (!(await hasMembership(existing.userId, existing.tenantId))) {
    return err(new UnauthorizedError("Invalid refresh token"));
  }

  // Single-use: only the request that flips revokedAt may mint a successor.
  const [rotated] = await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthAccessTokens.id, existing.id),
        isNull(oauthAccessTokens.revokedAt),
      ),
    )
    .returning({ id: oauthAccessTokens.id });
  if (!rotated) {
    return err(new UnauthorizedError("Invalid refresh token"));
  }

  return issueApiUserTokens(log, {
    client,
    userId: existing.userId,
    audience: resource,
    grantType: "refresh_token",
  });
}

/**
 * RFC 7009 token revocation for public clients. Accepts an access or refresh
 * token; always succeeds (no existence oracle). Revoking either half of an
 * issued pair revokes the row (access + refresh).
 */
export async function revokeToken(
  log: Logger,
  params: { token: string; client_id: string; tenant?: string | undefined },
): Promise<Result<{ revoked: boolean }, JacklineError>> {
  const clientResult = await resolveOauthClient(
    log,
    params.client_id,
    params.tenant,
  );
  if (clientResult.isErr()) return err(clientResult.error);
  const client = clientResult.value;

  const hash = hashToken(params.token);
  const now = new Date();
  const byAccess = await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthAccessTokens.clientId, client.id),
        eq(oauthAccessTokens.tokenHash, hash),
        isNull(oauthAccessTokens.revokedAt),
      ),
    )
    .returning({ id: oauthAccessTokens.id });
  const byRefresh = await db
    .update(oauthAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthAccessTokens.clientId, client.id),
        eq(oauthAccessTokens.refreshTokenHash, hash),
        isNull(oauthAccessTokens.revokedAt),
      ),
    )
    .returning({ id: oauthAccessTokens.id });

  const revoked = byAccess.length + byRefresh.length > 0;
  log.info({ clientId: client.id, revoked }, "mcpOauth.revoke");
  return ok({ revoked });
}

export const mcpOauthServices = {
  buildAsMetadata,
  registerDcrClient,
  validateAuthorizeRequest,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  revokeToken,
  ensureCliClient,
  resolveOauthClient,
  ensureConnection,
} as const;
