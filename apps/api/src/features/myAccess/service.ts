import { and, eq, inArray, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, oauthApps, secrets, servers, upstreamAccounts } from "@jackline/db";
import {
  BadRequestError,
  JacklineError,
  NotFoundError,
  type MyAccessAccount,
  OAUTH_CLIENT_SECRET_KIND,
  SetupError,
  upstreamSecretKind,
  connectorUsesPublicOAuthClient,
  connectorOAuthRegistrationUrl,
  resolveServerOAuthClient,
  type MyAccessServer,
  type PublicSecret,
  type UpstreamCredentialStatus,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";
import { toOAuthAppClientRef } from "../oauthApps/credentials.js";

function readinessFor(input: {
  credentialMode: "shared" | "subject_required" | "either";
  subjectConnected: boolean;
  sharedAvailable: boolean;
}): UpstreamCredentialStatus["readiness"] {
  const { credentialMode, subjectConnected, sharedAvailable } = input;
  if (credentialMode === "shared") {
    return sharedAvailable ? "ready_shared_only" : "missing_shared";
  }
  if (credentialMode === "subject_required") {
    return subjectConnected ? "ready_personal" : "missing_personal";
  }
  if (subjectConnected) return "ready_personal";
  if (sharedAvailable) return "ready_shared";
  return "missing_personal";
}

async function listMyServers(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<{ items: MyAccessServer[] }, JacklineError>> {
  const serverRows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.tenantId, tenantId), eq(servers.status, "active")));

  if (serverRows.length === 0) {
    return ok({ items: [] });
  }

  const serverIds = serverRows.map((s) => s.id);
  const secretRows = await db
    .select({
      serverId: secrets.serverId,
      userId: secrets.userId,
      kind: secrets.kind,
      upstreamAccountId: secrets.upstreamAccountId,
    })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        inArray(secrets.serverId, serverIds),
        isNull(secrets.connectionId),
      ),
    );

  const appIds = [
    ...new Set(
      serverRows
        .map((s) => s.oauthAppId)
        .filter((id): id is string => id != null),
    ),
  ];
  const appRows =
    appIds.length > 0
      ? await db
          .select()
          .from(oauthApps)
          .where(
            and(eq(oauthApps.tenantId, tenantId), inArray(oauthApps.id, appIds)),
          )
      : [];
  const appsById = new Map(appRows.map((a) => [a.id, toOAuthAppClientRef(a)]));
  const accountRows = await db
    .select()
    .from(upstreamAccounts)
    .where(
      and(
        eq(upstreamAccounts.tenantId, tenantId),
        eq(upstreamAccounts.userId, userId),
        inArray(upstreamAccounts.serverId, serverIds),
      ),
    );

  const items: MyAccessServer[] = serverRows.map((server) => {
    const kind = upstreamSecretKind(server.authMethod);
    const accounts: MyAccessAccount[] = accountRows
      .filter((account) => account.serverId === server.id)
      .map((account) => ({
        id: account.id,
        label: account.label,
        externalEmail: account.externalEmail,
        externalSubject: account.externalSubject,
        isDefault: account.isDefault,
        lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
        status: (secretRows.some(
          (secret) =>
            secret.upstreamAccountId === account.id && secret.kind === kind,
        )
          ? "connected"
          : "missing") as MyAccessAccount["status"],
      }))
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
    const subjectConnected =
      accounts.some((account) => account.status === "connected") ||
      secretRows.some(
        (s) =>
          s.serverId === server.id &&
          s.userId === userId &&
          s.kind === kind &&
          s.upstreamAccountId == null,
      );
    const sharedFallbackAvailable = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === null &&
        s.kind === kind,
    );
    const canConnect = server.credentialMode !== "shared";
    const registrationUrl =
      server.oauthRegistrationUrl?.trim() ||
      connectorOAuthRegistrationUrl(server.connectorKey);
    const publicOAuthClient =
      connectorUsesPublicOAuthClient(server.connectorKey) ||
      !!server.oauthRegistrationUrl?.trim();
    const hasOauthAppSecret = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === null &&
        s.kind === OAUTH_CLIENT_SECRET_KIND,
    );
    const linkedApp = server.oauthAppId
      ? appsById.get(server.oauthAppId)
      : undefined;
    const resolvedClient = resolveServerOAuthClient(server, linkedApp);
    const oauthConnectAvailable =
      resolvedClient.source === "app"
        ? // Shared app: client id + (optional) secret come from the app.
          server.authMethod === "oauth" &&
          !!resolvedClient.authorizeUrl &&
          !!resolvedClient.tokenUrl
        : server.authMethod === "oauth" &&
          !!server.oauthAuthorizeUrl &&
          !!server.oauthTokenUrl &&
          (!!server.oauthClientId || !!registrationUrl) &&
          (publicOAuthClient || hasOauthAppSecret);

    return {
      serverId: server.id,
      name: server.name,
      authMethod: server.authMethod,
      credentialMode: server.credentialMode,
      status: subjectConnected ? "connected" : "missing",
      canConnect,
      sharedFallbackAvailable,
      oauthConnectAvailable,
      accounts: server.authMethod === "oauth" ? accounts : [],
    };
  });

  log.debug(
    { tenantId, userId, count: items.length },
    "MyAccess.services.listMyServers",
  );
  return ok({ items });
}

async function upsertMyCredential(
  log: Logger,
  tenantId: string,
  userId: string,
  serverId: string,
  input: { name?: string | undefined; value: string },
): Promise<Result<PublicSecret, JacklineError>> {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!server) {
    return err(new NotFoundError("Server not found"));
  }

  if (server.credentialMode === "shared") {
    return err(
      new BadRequestError(
        "This server uses a shared org credential. Members cannot connect a personal account.",
      ),
    );
  }

  const kind = upstreamSecretKind(server.authMethod);
  if (server.authMethod === "mtls") {
    return err(new BadRequestError("mTLS upstream auth is not supported yet"));
  }

  const accountId =
    kind === "oauth"
      ? await pasteTargetAccountId(tenantId, userId, server.id, server.name)
      : ok<string | null, JacklineError>(null);
  if (accountId.isErr()) return err(accountId.error);

  const [existing] = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        eq(secrets.userId, userId),
        eq(secrets.kind, kind),
        isNull(secrets.connectionId),
        accountId.value
          ? eq(secrets.upstreamAccountId, accountId.value)
          : isNull(secrets.upstreamAccountId),
      ),
    )
    .limit(1);

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const aad = secretAad({
    tenantId,
    kind,
    serverId,
    userId,
    connectionId: null,
  });

  const encrypted = boxResult.value.encrypt(
    new TextEncoder().encode(input.value),
    aad,
  );
  if (encrypted.isErr()) return err(encrypted.error);

  const name = input.name?.trim() || `${server.name} personal ${kind}`;

  try {
    if (existing) {
      const [row] = await db
        .update(secrets)
        .set({
          name,
          ciphertext: encrypted.value.ciphertext,
          nonce: encrypted.value.nonce,
          keyVersion: encrypted.value.keyVersion,
          updatedAt: new Date(),
        })
        .where(eq(secrets.id, existing.id))
        .returning();

      if (!row) {
        return err(new SetupError("Failed to update credential"));
      }

      log.info(
        { secretId: row.id, tenantId, serverId, userId },
        "MyAccess.services.upsertMyCredential.updated",
      );
      return ok({
        id: row.id,
        kind: row.kind,
        name: row.name,
        keyVersion: row.keyVersion,
        meta: row.meta,
        serverId: row.serverId,
        userId: row.userId,
        connectionId: row.connectionId,
        tenantId: row.tenantId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    const [row] = await db
      .insert(secrets)
      .values({
        kind,
        name,
        ciphertext: encrypted.value.ciphertext,
        nonce: encrypted.value.nonce,
        keyVersion: encrypted.value.keyVersion,
        meta: {},
        serverId,
        userId,
        connectionId: null,
        upstreamAccountId: accountId.value,
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create credential"));
    }

    log.info(
      { secretId: row.id, tenantId, serverId, userId },
      "MyAccess.services.upsertMyCredential.created",
    );
    return ok({
      id: row.id,
      kind: row.kind,
      name: row.name,
      keyVersion: row.keyVersion,
      meta: row.meta,
      serverId: row.serverId,
      userId: row.userId,
      connectionId: row.connectionId,
      tenantId: row.tenantId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (cause) {
    return err(
      fromDbWriteError(cause, "A credential already exists for this server"),
    );
  }
}

async function deleteMyCredential(
  log: Logger,
  tenantId: string,
  userId: string,
  serverId: string,
): Promise<Result<{ deleted: true }, JacklineError>> {
  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!server) {
    return err(new NotFoundError("Server not found"));
  }

  const kind = upstreamSecretKind(server.authMethod);
  const removedAccounts = await db
    .delete(upstreamAccounts)
    .where(
      and(
        eq(upstreamAccounts.tenantId, tenantId),
        eq(upstreamAccounts.serverId, serverId),
        eq(upstreamAccounts.userId, userId),
      ),
    )
    .returning({ id: upstreamAccounts.id });
  const [row] = await db
    .delete(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.serverId, serverId),
        eq(secrets.userId, userId),
        eq(secrets.kind, kind),
        isNull(secrets.connectionId),
      ),
    )
    .returning();

  if (!row && removedAccounts.length === 0) {
    return err(new NotFoundError("Credential not found"));
  }

  log.info(
    { secretId: row?.id ?? null, removedAccounts: removedAccounts.length, tenantId, serverId, userId },
    "MyAccess.services.deleteMyCredential",
  );
  return ok({ deleted: true });
}

async function listUpstreamCredentialsForSubject(
  log: Logger,
  tenantId: string,
  subjectUserId: string,
): Promise<Result<{ items: UpstreamCredentialStatus[] }, JacklineError>> {
  const serverRows = await db
    .select()
    .from(servers)
    .where(and(eq(servers.tenantId, tenantId), eq(servers.status, "active")));

  if (serverRows.length === 0) {
    return ok({ items: [] });
  }

  const serverIds = serverRows.map((s) => s.id);
  const secretRows = await db
    .select({
      serverId: secrets.serverId,
      userId: secrets.userId,
      kind: secrets.kind,
    })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        inArray(secrets.serverId, serverIds),
        isNull(secrets.connectionId),
      ),
    );

  const items: UpstreamCredentialStatus[] = serverRows.map((server) => {
    const kind = upstreamSecretKind(server.authMethod);
    const subjectConnected = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === subjectUserId &&
        s.kind === kind,
    );
    const sharedAvailable = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === null &&
        s.kind === kind,
    );

    return {
      serverId: server.id,
      name: server.name,
      credentialMode: server.credentialMode,
      subjectConnected,
      sharedAvailable,
      readiness: readinessFor({
        credentialMode: server.credentialMode,
        subjectConnected,
        sharedAvailable,
      }),
    };
  });

  log.debug(
    { tenantId, subjectUserId, count: items.length },
    "MyAccess.services.listUpstreamCredentialsForSubject",
  );
  return ok({ items });
}

async function pasteTargetAccountId(
  tenantId: string,
  userId: string,
  serverId: string,
  serverName: string,
): Promise<Result<string, JacklineError>> {
  const rows = await db
    .select()
    .from(upstreamAccounts)
    .where(
      and(
        eq(upstreamAccounts.tenantId, tenantId),
        eq(upstreamAccounts.serverId, serverId),
        eq(upstreamAccounts.userId, userId),
      ),
    );
  const target = rows.find((row) => row.isDefault) ?? (rows.length === 1 ? rows[0] : undefined);
  if (!target && rows.length > 1) {
    return err(
      new BadRequestError(
        "Several accounts are connected and none is the default. Pick an account in My Access.",
      ),
    );
  }
  if (target) return ok(target.id);
  const [created] = await db
    .insert(upstreamAccounts)
    .values({
      label: "Default",
      isDefault: true,
      serverId,
      userId,
      tenantId,
    })
    .returning({ id: upstreamAccounts.id });
  if (!created) {
    return err(new SetupError(`Failed to store an account for ${serverName}`));
  }
  return ok(created.id);
}

async function loadOwnAccount(tenantId: string, userId: string, accountId: string) {
  const [row] = await db
    .select()
    .from(upstreamAccounts)
    .where(
      and(
        eq(upstreamAccounts.id, accountId),
        eq(upstreamAccounts.tenantId, tenantId),
        eq(upstreamAccounts.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function toMyAccessAccount(
  row: typeof upstreamAccounts.$inferSelect,
  connected: boolean,
): MyAccessAccount {
  return {
    id: row.id,
    label: row.label,
    externalEmail: row.externalEmail,
    externalSubject: row.externalSubject,
    isDefault: row.isDefault,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    status: connected ? "connected" : "missing",
  };
}

async function renameAccount(
  log: Logger,
  tenantId: string,
  userId: string,
  accountId: string,
  label: string,
): Promise<Result<MyAccessAccount, JacklineError>> {
  const existing = await loadOwnAccount(tenantId, userId, accountId);
  if (!existing) return err(new NotFoundError("Account not found"));
  try {
    const [row] = await db
      .update(upstreamAccounts)
      .set({ label: label.trim(), updatedAt: new Date() })
      .where(eq(upstreamAccounts.id, existing.id))
      .returning();
    if (!row) return err(new NotFoundError("Account not found"));
    log.info({ accountId, tenantId, userId }, "MyAccess.services.renameAccount");
    return ok(toMyAccessAccount(row, true));
  } catch (cause) {
    return err(fromDbWriteError(cause, "An account with that label already exists"));
  }
}

async function makeDefaultAccount(
  log: Logger,
  tenantId: string,
  userId: string,
  accountId: string,
): Promise<Result<MyAccessAccount, JacklineError>> {
  const existing = await loadOwnAccount(tenantId, userId, accountId);
  if (!existing) return err(new NotFoundError("Account not found"));
  const [row] = await db.transaction(async (tx) => {
    await tx
      .update(upstreamAccounts)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(upstreamAccounts.tenantId, tenantId),
          eq(upstreamAccounts.serverId, existing.serverId),
          eq(upstreamAccounts.userId, userId),
        ),
      );
    return tx
      .update(upstreamAccounts)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(upstreamAccounts.id, existing.id))
      .returning();
  });
  if (!row) return err(new NotFoundError("Account not found"));
  log.info({ accountId, tenantId, userId }, "MyAccess.services.makeDefaultAccount");
  return ok(toMyAccessAccount(row, true));
}

async function deleteAccount(
  log: Logger,
  tenantId: string,
  userId: string,
  accountId: string,
): Promise<Result<{ deleted: true }, JacklineError>> {
  const existing = await loadOwnAccount(tenantId, userId, accountId);
  if (!existing) return err(new NotFoundError("Account not found"));
  await db.transaction(async (tx) => {
    await tx.delete(upstreamAccounts).where(eq(upstreamAccounts.id, existing.id));
    if (!existing.isDefault) return;
    const [next] = await tx
      .select({ id: upstreamAccounts.id })
      .from(upstreamAccounts)
      .where(
        and(
          eq(upstreamAccounts.tenantId, tenantId),
          eq(upstreamAccounts.serverId, existing.serverId),
          eq(upstreamAccounts.userId, userId),
        ),
      )
      .limit(1);
    if (!next) return;
    await tx
      .update(upstreamAccounts)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(upstreamAccounts.id, next.id));
  });
  log.info({ accountId, tenantId, userId }, "MyAccess.services.deleteAccount");
  return ok({ deleted: true });
}

export const myAccessServices = {
  listMyServers,
  upsertMyCredential,
  deleteMyCredential,
  listUpstreamCredentialsForSubject,
  renameAccount,
  makeDefaultAccount,
  deleteAccount,
} as const;
