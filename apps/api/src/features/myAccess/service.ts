import { and, eq, inArray, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, secrets, servers } from "@jackline/db";
import {
  BadRequestError,
  JacklineError,
  NotFoundError,
  OAUTH_CLIENT_SECRET_KIND,
  SetupError,
  upstreamSecretKind,
  connectorUsesPublicOAuthClient,
  type MyAccessServer,
  type PublicSecret,
  type UpstreamCredentialStatus,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";

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
    })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        inArray(secrets.serverId, serverIds),
        isNull(secrets.connectionId),
      ),
    );

  const items: MyAccessServer[] = serverRows.map((server) => {
    const kind = upstreamSecretKind(server.authMethod);
    const subjectConnected = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === userId &&
        s.kind === kind,
    );
    const sharedFallbackAvailable = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === null &&
        s.kind === kind,
    );
    const canConnect = server.credentialMode !== "shared";
    const publicOAuthClient = connectorUsesPublicOAuthClient(server.connectorKey);
    const hasOauthAppSecret = secretRows.some(
      (s) =>
        s.serverId === server.id &&
        s.userId === null &&
        s.kind === OAUTH_CLIENT_SECRET_KIND,
    );
    const oauthConnectAvailable =
      server.authMethod === "oauth" &&
      !!server.oauthAuthorizeUrl &&
      !!server.oauthTokenUrl &&
      !!server.oauthClientId &&
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

  if (!row) {
    return err(new NotFoundError("Credential not found"));
  }

  log.info(
    { secretId: row.id, tenantId, serverId, userId },
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

export const myAccessServices = {
  listMyServers,
  upsertMyCredential,
  deleteMyCredential,
  listUpstreamCredentialsForSubject,
} as const;
