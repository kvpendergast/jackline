import { and, eq, isNull, lt } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { auth } from "@jackline/auth";
import {
  db,
  oauthStates,
  secrets,
  servers,
} from "@jackline/db";
import {
  BadRequestError,
  buildOAuthAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  encodeOAuthSecretValue,
  exchangeAuthorizationCode,
  ForbiddenError,
  getConfig,
  getConnectorPreset,
  JacklineError,
  NotFoundError,
  connectorUsesPublicOAuthClient,
  OAUTH_CLIENT_SECRET_KIND,
  oauthCallbackUrl,
  publicApiBaseUrl,
  SetupError,
  UnauthorizedError,
  upstreamSecretKind,
  type StartOauthResult,
} from "@jackline/shared";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";

const STATE_TTL_MS = 15 * 60 * 1000;

async function loadOauthClientSecret(
  tenantId: string,
  serverId: string,
): Promise<Result<string, JacklineError>> {
  const [row] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        eq(secrets.kind, OAUTH_CLIENT_SECRET_KIND),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  if (!row) {
    return err(
      new BadRequestError(
        "OAuth app client secret is not configured for this server",
      ),
    );
  }

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId,
    kind: OAUTH_CLIENT_SECRET_KIND,
    serverId,
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

async function startConnect(
  log: Logger,
  tenantId: string,
  userId: string,
  serverId: string,
): Promise<Result<StartOauthResult, JacklineError>> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);

  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!server) {
    return err(new NotFoundError("Server not found"));
  }

  if (server.authMethod !== "oauth") {
    return err(
      new BadRequestError("This server does not use OAuth authentication"),
    );
  }

  if (server.credentialMode === "shared") {
    return err(
      new ForbiddenError(
        "This server uses a shared org credential. Members cannot connect a personal account.",
      ),
    );
  }

  if (
    !server.oauthAuthorizeUrl ||
    !server.oauthTokenUrl ||
    !server.oauthClientId
  ) {
    return err(
      new BadRequestError(
        "OAuth Connect is not configured. Ask an admin to set authorize URL, token URL, and client id on the server.",
      ),
    );
  }

  const publicClient = connectorUsesPublicOAuthClient(server.connectorKey);
  if (!publicClient) {
    const clientSecret = await loadOauthClientSecret(tenantId, serverId);
    if (clientSecret.isErr()) return err(clientSecret.error);
  }

  await db
    .delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date()));

  const state = createOAuthState();
  const pkce = await createPkcePair();
  const redirectUri = oauthCallbackUrl(publicApiBaseUrl(config.value));

  await db.insert(oauthStates).values({
    state,
    codeVerifier: pkce.codeVerifier,
    tenantId,
    userId,
    serverId,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });

  const catalogPreset =
    server.connectorKey != null
      ? getConnectorPreset(server.connectorKey)
      : undefined;

  const authorizeExtra: Record<string, string> = {
    ...(catalogPreset?.oauthAuthorizeExtraParams ?? {}),
  };
  if (catalogPreset?.oauthResource) {
    authorizeExtra["resource"] = catalogPreset.oauthResource;
  }

  const authorizeUrl = buildOAuthAuthorizeUrl({
    authorizeUrl: server.oauthAuthorizeUrl,
    clientId: server.oauthClientId,
    redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
    scopes: server.oauthScopes,
    extraParams: Object.keys(authorizeExtra).length > 0 ? authorizeExtra : null,
  });

  log.info({ tenantId, userId, serverId }, "Oauth.services.startConnect");
  return ok({ authorizeUrl, redirectUri });
}

async function handleCallback(
  log: Logger,
  input: { code: string | undefined; state: string | undefined },
): Promise<Result<{ redirectTo: string }, JacklineError>> {
  const config = getConfig();
  if (config.isErr()) return err(config.error);

  const webOrigin = config.value.WEB_ORIGIN.replace(/\/$/, "");

  if (!input.code || !input.state) {
    return err(new BadRequestError("Missing code or state"));
  }

  const [pending] = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.state, input.state))
    .limit(1);

  if (!pending) {
    return err(new BadRequestError("Invalid or expired OAuth state"));
  }

  await db.delete(oauthStates).where(eq(oauthStates.id, pending.id));

  if (pending.expiresAt.getTime() < Date.now()) {
    return err(new BadRequestError("OAuth state expired — try Connect again"));
  }

  const [server] = await db
    .select()
    .from(servers)
    .where(
      and(
        eq(servers.id, pending.serverId),
        eq(servers.tenantId, pending.tenantId),
      ),
    )
    .limit(1);

  if (!server || !server.oauthTokenUrl || !server.oauthClientId) {
    return err(new NotFoundError("Server OAuth configuration missing"));
  }

  const publicClient = connectorUsesPublicOAuthClient(server.connectorKey);
  let clientSecretValue = "";
  if (!publicClient) {
    const clientSecret = await loadOauthClientSecret(
      pending.tenantId,
      pending.serverId,
    );
    if (clientSecret.isErr()) return err(clientSecret.error);
    clientSecretValue = clientSecret.value;
  }

  const catalogPreset =
    server.connectorKey != null
      ? getConnectorPreset(server.connectorKey)
      : undefined;

  const redirectUri = oauthCallbackUrl(publicApiBaseUrl(config.value));
  const tokens = await exchangeAuthorizationCode({
    tokenUrl: server.oauthTokenUrl,
    code: input.code,
    redirectUri,
    clientId: server.oauthClientId,
    ...(clientSecretValue ? { clientSecret: clientSecretValue } : {}),
    codeVerifier: pending.codeVerifier,
    ...(catalogPreset?.oauthResource
      ? { resource: catalogPreset.oauthResource }
      : {}),
  });
  if (tokens.isErr()) return err(tokens.error);

  const encoded = encodeOAuthSecretValue(
    tokens.value.refreshToken
      ? {
          mode: "refreshable" as const,
          accessToken: tokens.value.accessToken,
          refreshToken: tokens.value.refreshToken,
          tokenUrl: server.oauthTokenUrl,
          clientId: server.oauthClientId,
          ...(clientSecretValue ? { clientSecret: clientSecretValue } : {}),
          ...(server.oauthScopes ? { scopes: server.oauthScopes } : {}),
          ...(tokens.value.expiresAt
            ? { expiresAt: tokens.value.expiresAt }
            : {}),
        }
      : {
          mode: "access_token" as const,
          accessToken: tokens.value.accessToken,
          ...(tokens.value.expiresAt
            ? { expiresAt: tokens.value.expiresAt }
            : {}),
        },
  );
  if (encoded.isErr()) return err(encoded.error);

  const kind = upstreamSecretKind("oauth");
  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId: pending.tenantId,
    kind,
    serverId: pending.serverId,
    userId: pending.userId,
    connectionId: null,
  });

  const encrypted = boxResult.value.encrypt(
    new TextEncoder().encode(encoded.value),
    aad,
  );
  if (encrypted.isErr()) return err(encrypted.error);

  const [existing] = await db
    .select({ id: secrets.id })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, pending.tenantId),
        eq(secrets.serverId, pending.serverId),
        eq(secrets.userId, pending.userId),
        eq(secrets.kind, kind),
        isNull(secrets.connectionId),
      ),
    )
    .limit(1);

  const name = `${server.name} personal oauth`;

  if (existing) {
    await db
      .update(secrets)
      .set({
        name,
        ciphertext: encrypted.value.ciphertext,
        nonce: encrypted.value.nonce,
        keyVersion: encrypted.value.keyVersion,
        updatedAt: new Date(),
      })
      .where(eq(secrets.id, existing.id));
  } else {
    const [created] = await db
      .insert(secrets)
      .values({
        kind,
        name,
        ciphertext: encrypted.value.ciphertext,
        nonce: encrypted.value.nonce,
        keyVersion: encrypted.value.keyVersion,
        serverId: pending.serverId,
        userId: pending.userId,
        connectionId: null,
        tenantId: pending.tenantId,
      })
      .returning({ id: secrets.id });

    if (!created) {
      return err(new SetupError("Failed to store OAuth credential"));
    }
  }

  log.info(
    {
      tenantId: pending.tenantId,
      userId: pending.userId,
      serverId: pending.serverId,
    },
    "Oauth.services.handleCallback",
  );

  const redirectTo = `${webOrigin}/my-access?server=${encodeURIComponent(pending.serverId)}&connected=1`;
  return ok({ redirectTo });
}

/** Resolve session user for the public callback error pages (best-effort). */
async function requireSessionUser(
  headers: Headers,
): Promise<Result<{ userId: string }, JacklineError>> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return err(new UnauthorizedError("No session"));
  }
  return ok({ userId: session.user.id });
}

export const oauthServices = {
  startConnect,
  handleCallback,
  requireSessionUser,
} as const;
