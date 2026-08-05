import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, secrets, servers, type Server } from "@mesh/db";
import {
  MeshError,
  NotFoundError,
  OAUTH_CLIENT_SECRET_KIND,
  SetupError,
  type CursorPage,
  type PublicServer,
  type ServerAuthMethod,
  type ServerCredentialMode,
  type ServerKind,
  type ServerSource,
  type ServerStatus,
} from "@mesh/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

import { syncToolsFromUpstream } from "./syncTools.js";

export type CreateServerInput = {
  name: string;
  baseUrl: string;
  authMethod: ServerAuthMethod;
  kind: ServerKind;
  source?: ServerSource | undefined;
  credentialMode?: ServerCredentialMode | undefined;
  connectorKey?: string | null | undefined;
  docsUrl?: string | null | undefined;
  oauthAuthorizeUrl?: string | null | undefined;
  oauthTokenUrl?: string | null | undefined;
  oauthScopes?: string | null | undefined;
  oauthClientId?: string | null | undefined;
};

export type UpdateServerInput = {
  name?: string | undefined;
  baseUrl?: string | undefined;
  authMethod?: ServerAuthMethod | undefined;
  kind?: ServerKind | undefined;
  source?: ServerSource | undefined;
  status?: ServerStatus | undefined;
  credentialMode?: ServerCredentialMode | undefined;
  connectorKey?: string | null | undefined;
  docsUrl?: string | null | undefined;
  oauthAuthorizeUrl?: string | null | undefined;
  oauthTokenUrl?: string | null | undefined;
  oauthScopes?: string | null | undefined;
  oauthClientId?: string | null | undefined;
};

async function loadOauthClientSecretFlags(
  tenantId: string,
  serverIds: string[],
): Promise<Set<string>> {
  if (serverIds.length === 0) return new Set();
  const rows = await db
    .select({ serverId: secrets.serverId })
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.kind, OAUTH_CLIENT_SECRET_KIND),
        inArray(secrets.serverId, serverIds),
        isNull(secrets.userId),
        isNull(secrets.connectionId),
      ),
    );
  return new Set(
    rows.map((r) => r.serverId).filter((id): id is string => id != null),
  );
}

function toPublicServer(
  row: Server,
  hasOauthClientSecret: boolean,
): PublicServer {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    authMethod: row.authMethod,
    credentialMode: row.credentialMode,
    source: row.source,
    kind: row.kind,
    status: row.status,
    health: row.health,
    connectorKey: row.connectorKey,
    docsUrl: row.docsUrl,
    oauthAuthorizeUrl: row.oauthAuthorizeUrl,
    oauthTokenUrl: row.oauthTokenUrl,
    oauthScopes: row.oauthScopes,
    oauthClientId: row.oauthClientId,
    hasOauthClientSecret,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function create(
  log: Logger,
  tenantId: string,
  input: CreateServerInput,
): Promise<Result<PublicServer, MeshError>> {
  try {
    const [row] = await db
      .insert(servers)
      .values({
        name: input.name,
        baseUrl: input.baseUrl,
        authMethod: input.authMethod,
        kind: input.kind,
        source: input.source ?? "custom",
        credentialMode: input.credentialMode ?? "either",
        connectorKey: input.connectorKey ?? null,
        docsUrl: input.docsUrl ?? null,
        oauthAuthorizeUrl: input.oauthAuthorizeUrl ?? null,
        oauthTokenUrl: input.oauthTokenUrl ?? null,
        oauthScopes: input.oauthScopes ?? null,
        oauthClientId: input.oauthClientId ?? null,
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create server"));
    }

    log.info({ serverId: row.id, tenantId }, "server created");
    return ok(toPublicServer(row, false));
  } catch (cause) {
    return err(
      fromDbWriteError(cause, "A server with this name already exists"),
    );
  }
}

async function list(
  log: Logger,
  tenantId: string,
  query: PaginationQuery,
): Promise<Result<CursorPage<PublicServer>, MeshError>> {
  const conditions = [eq(servers.tenantId, tenantId)];

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) {
      return err(decoded.error);
    }

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(servers.createdAt, createdAt),
        and(eq(servers.createdAt, createdAt), lt(servers.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(servers)
    .where(and(...conditions))
    .orderBy(desc(servers.createdAt), desc(servers.id))
    .limit(query.limit + 1);

  const page = toCursorPage(rows, query.limit, (row) =>
    encodeCreatedAtIdCursor({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
  );

  const flags = await loadOauthClientSecretFlags(
    tenantId,
    page.items.map((r) => r.id),
  );

  log.debug(
    {
      tenantId,
      count: page.items.length,
      hasMore: page.nextCursor !== null,
    },
    "listServers",
  );

  return ok({
    items: page.items.map((row) =>
      toPublicServer(row, flags.has(row.id)),
    ),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  serverId: string,
): Promise<Result<PublicServer, MeshError>> {
  const [row] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Server not found"));
  }

  const flags = await loadOauthClientSecretFlags(tenantId, [serverId]);
  log.debug({ serverId, tenantId }, "getServer");
  return ok(toPublicServer(row, flags.has(serverId)));
}

async function update(
  log: Logger,
  tenantId: string,
  serverId: string,
  input: UpdateServerInput,
): Promise<Result<PublicServer, MeshError>> {
  const patch: Partial<typeof servers.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
  if (input.authMethod !== undefined) patch.authMethod = input.authMethod;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.source !== undefined) patch.source = input.source;
  if (input.status !== undefined) patch.status = input.status;
  if (input.credentialMode !== undefined) {
    patch.credentialMode = input.credentialMode;
  }
  if (input.connectorKey !== undefined) patch.connectorKey = input.connectorKey;
  if (input.docsUrl !== undefined) patch.docsUrl = input.docsUrl;
  if (input.oauthAuthorizeUrl !== undefined) {
    patch.oauthAuthorizeUrl = input.oauthAuthorizeUrl;
  }
  if (input.oauthTokenUrl !== undefined) {
    patch.oauthTokenUrl = input.oauthTokenUrl;
  }
  if (input.oauthScopes !== undefined) patch.oauthScopes = input.oauthScopes;
  if (input.oauthClientId !== undefined) {
    patch.oauthClientId = input.oauthClientId;
  }

  try {
    const [row] = await db
      .update(servers)
      .set(patch)
      .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
      .returning();

    if (!row) {
      return err(new NotFoundError("Server not found"));
    }

    const flags = await loadOauthClientSecretFlags(tenantId, [serverId]);
    log.info({ serverId, tenantId }, "server updated");
    return ok(toPublicServer(row, flags.has(serverId)));
  } catch (cause) {
    return err(
      fromDbWriteError(cause, "A server with this name already exists"),
    );
  }
}

async function remove(
  log: Logger,
  tenantId: string,
  serverId: string,
): Promise<Result<PublicServer, MeshError>> {
  const [row] = await db
    .delete(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Server not found"));
  }

  log.info({ serverId, tenantId }, "server deleted");
  return ok(toPublicServer(row, false));
}

export const serverServices = {
  list,
  create,
  get,
  update,
  delete: remove,
  syncTools: syncToolsFromUpstream,
} as const;
