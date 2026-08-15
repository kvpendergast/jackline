import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  clients,
  connectionRoles,
  connections,
  connectionToolOverrides,
  db,
  memberships,
  roles,
  secrets,
  tools,
  roleTools,
  user,
  type Connection as ConnectionRow,
  type Secret as SecretRow,
} from "@mesh/db";
import {
  BadRequestError,
  ForbiddenError,
  formatGatewayToken,
  GATEWAY_TOKEN_KIND,
  getConfig,
  publicMcpUrl,
  MeshError,
  NotFoundError,
  SetupError,
  type ConnectionStatus,
  type ConnectionToolOverrideType,
  type CursorPage,
  type MintedGatewayCredential,
  type PublicConnection,
  type PublicConnectionDetail,
  type PublicConnectionToolOverride,
  type PublicGatewayCredential,
} from "@mesh/shared";
import {
  resolveTeamFilter,
  isAdminRole,
  type ActorAuthz,
} from "../../lib/authz/teamScope.js";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";
import { getSecretBox, secretAad } from "../../lib/secrets/secretBox.js";

export type CreateConnectionInput = {
  clientId: string;
  userId: string;
  status?: ConnectionStatus | undefined;
};

export type UpdateConnectionInput = {
  status?: ConnectionStatus | undefined;
};

export type ListConnectionsQuery = PaginationQuery & {
  clientId?: string | undefined;
  userId?: string | undefined;
  status?: ConnectionStatus | undefined;
};

export type SetToolOverrideInput = {
  toolId: string;
  type: ConnectionToolOverrideType;
};

function toPublicConnection(row: ConnectionRow): PublicConnection {
  return {
    id: row.id,
    status: row.status,
    clientId: row.clientId,
    userId: row.userId,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadRoleIds(
  tenantId: string,
  connectionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ roleId: connectionRoles.roleId })
    .from(connectionRoles)
    .where(
      and(
        eq(connectionRoles.connectionId, connectionId),
        eq(connectionRoles.tenantId, tenantId),
      ),
    );
  return rows.map((row) => row.roleId);
}

async function loadToolOverrides(
  tenantId: string,
  connectionId: string,
): Promise<PublicConnectionToolOverride[]> {
  const rows = await db
    .select({
      toolId: connectionToolOverrides.toolId,
      type: connectionToolOverrides.type,
    })
    .from(connectionToolOverrides)
    .where(
      and(
        eq(connectionToolOverrides.connectionId, connectionId),
        eq(connectionToolOverrides.tenantId, tenantId),
      ),
    );
  return rows.map((row) => ({ toolId: row.toolId, type: row.type }));
}

async function toDetail(
  tenantId: string,
  row: ConnectionRow,
): Promise<PublicConnectionDetail> {
  const [roleIds, toolOverrides] = await Promise.all([
    loadRoleIds(tenantId, row.id),
    loadToolOverrides(tenantId, row.id),
  ]);
  return { ...toPublicConnection(row), roleIds, toolOverrides };
}

async function getConnectionRow(
  tenantId: string,
  connectionId: string,
): Promise<Result<ConnectionRow, MeshError>> {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)),
    )
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Connection not found"));
  }

  return ok(row);
}

async function assertUserInTenant(
  tenantId: string,
  userId: string,
  teamFilter: string | null = null,
): Promise<Result<void, MeshError>> {
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!existingUser) {
    return err(new BadRequestError("userId does not reference a user"));
  }

  const conditions = [
    eq(memberships.userId, userId),
    eq(memberships.tenantId, tenantId),
  ];
  if (teamFilter) {
    conditions.push(eq(memberships.team, teamFilter));
  }

  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(...conditions))
    .limit(1);

  if (!membership) {
    if (teamFilter) {
      return err(new ForbiddenError("user is outside your team scope"));
    }
    return err(new BadRequestError("userId is not a member of this tenant"));
  }

  return ok(undefined);
}

async function assertConnectionInTeamScope(
  tenantId: string,
  connectionId: string,
  teamFilter: string | null,
): Promise<Result<ConnectionRow, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
  if (rowResult.isErr()) return err(rowResult.error);
  if (!teamFilter) return ok(rowResult.value);

  const userCheck = await assertUserInTenant(
    tenantId,
    rowResult.value.userId,
    teamFilter,
  );
  if (userCheck.isErr()) return err(userCheck.error);
  return ok(rowResult.value);
}

async function assertRolesInTenant(
  tenantId: string,
  roleIds: string[],
): Promise<Result<void, MeshError>> {
  if (roleIds.length === 0) return ok(undefined);

  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, roleIds)));

  if (found.length !== roleIds.length) {
    return err(
      new BadRequestError(
        "One or more roleIds do not reference roles in this tenant",
      ),
    );
  }

  return ok(undefined);
}

async function assertToolsInTenant(
  tenantId: string,
  toolIds: string[],
): Promise<Result<void, MeshError>> {
  if (toolIds.length === 0) return ok(undefined);

  const found = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.tenantId, tenantId), inArray(tools.id, toolIds)));

  if (found.length !== toolIds.length) {
    return err(
      new BadRequestError(
        "One or more toolIds do not reference tools in this tenant",
      ),
    );
  }

  return ok(undefined);
}

async function create(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  input: CreateConnectionInput,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const userId = isAdminRole(actor.role) ? input.userId : actor.userId;
  if (!isAdminRole(actor.role) && input.userId !== actor.userId) {
    return err(new ForbiddenError("Members can only create connections for themselves"));
  }

  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);
  const teamFilter = teamResult.value;

  const clientCheck = await assertActorCanUseClient(tenantId, actor, input.clientId);
  if (clientCheck.isErr()) return err(clientCheck.error);

  const userCheck = await assertUserInTenant(
    tenantId,
    userId,
    isAdminRole(actor.role) ? teamFilter : null,
  );
  if (userCheck.isErr()) return err(userCheck.error);

  try {
    const [row] = await db
      .insert(connections)
      .values({
        clientId: input.clientId,
        userId,
        status: input.status ?? "active",
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create connection"));
    }

    log.info({ connectionId: row.id, tenantId }, "Connection.services.create");
    return ok(await toDetail(tenantId, row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "A connection already exists for this client and user"));
  }
}

async function list(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  query: ListConnectionsQuery,
): Promise<Result<CursorPage<PublicConnection>, MeshError>> {
  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);
  const teamFilter = teamResult.value;

  const conditions = [eq(connections.tenantId, tenantId)];

  if (!isAdminRole(actor.role)) {
    conditions.push(eq(connections.userId, actor.userId));
    if (query.clientId) conditions.push(eq(connections.clientId, query.clientId));
    if (query.status) conditions.push(eq(connections.status, query.status));
  } else {
    if (query.clientId) conditions.push(eq(connections.clientId, query.clientId));
    if (query.userId) conditions.push(eq(connections.userId, query.userId));
    if (query.status) conditions.push(eq(connections.status, query.status));
    if (teamFilter) conditions.push(eq(memberships.team, teamFilter));
  }

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) return err(decoded.error);

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(connections.createdAt, createdAt),
        and(eq(connections.createdAt, createdAt), lt(connections.id, id)),
      )!,
    );
  }

  const baseQuery = db
    .select({ connection: connections })
    .from(connections);

  const rows = teamFilter
    ? await baseQuery
        .innerJoin(
          memberships,
          and(
            eq(memberships.userId, connections.userId),
            eq(memberships.tenantId, connections.tenantId),
          ),
        )
        .where(and(...conditions))
        .orderBy(desc(connections.createdAt), desc(connections.id))
        .limit(query.limit + 1)
    : await baseQuery
        .where(and(...conditions))
        .orderBy(desc(connections.createdAt), desc(connections.id))
        .limit(query.limit + 1);

  const page = toCursorPage(
    rows.map((r) => r.connection),
    query.limit,
    (row) =>
      encodeCreatedAtIdCursor({
        createdAt: row.createdAt.toISOString(),
        id: row.id,
      }),
  );

  log.debug(
    {
      tenantId,
      count: page.items.length,
      hasMore: page.nextCursor !== null,
      teamFilter,
    },
    "Connection.services.list",
  );

  return ok({
    items: page.items.map(toPublicConnection),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);

  const rowResult = await assertConnectionInTeamScope(
    tenantId,
    connectionId,
    teamResult.value,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  log.debug({ connectionId, tenantId }, "Connection.services.get");
  return ok(await toDetail(tenantId, rowResult.value));
}

async function update(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  input: UpdateConnectionInput,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);

  const scoped = await assertConnectionInTeamScope(
    tenantId,
    connectionId,
    teamResult.value,
  );
  if (scoped.isErr()) return err(scoped.error);

  const patch: Partial<typeof connections.$inferInsert> & { updatedAt: Date } =
    {
      updatedAt: new Date(),
    };

  if (input.status !== undefined) patch.status = input.status;

  const [row] = await db
    .update(connections)
    .set(patch)
    .where(
      and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)),
    )
    .returning();

  if (!row) {
    return err(new NotFoundError("Connection not found"));
  }

  log.info({ connectionId, tenantId }, "Connection.services.update");
  return ok(await toDetail(tenantId, row));
}

async function remove(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
): Promise<Result<PublicConnection, MeshError>> {
  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);

  const scoped = await assertConnectionInTeamScope(
    tenantId,
    connectionId,
    teamResult.value,
  );
  if (scoped.isErr()) return err(scoped.error);

  const [row] = await db
    .delete(connections)
    .where(
      and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)),
    )
    .returning();

  if (!row) {
    return err(new NotFoundError("Connection not found"));
  }

  log.info({ connectionId, tenantId }, "Connection.services.delete");
  return ok(toPublicConnection(row));
}

async function requireScopedConnection(
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
): Promise<Result<ConnectionRow, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
  if (rowResult.isErr()) return err(rowResult.error);
  const row = rowResult.value;

  if (row.userId === actor.userId) {
    return ok(row);
  }

  if (!isAdminRole(actor.role)) {
    return err(new ForbiddenError("You can only access your own connections"));
  }

  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);
  return assertConnectionInTeamScope(tenantId, connectionId, teamResult.value);
}

async function assertActorCanUseClient(
  tenantId: string,
  actor: ActorAuthz,
  clientId: string,
): Promise<Result<void, MeshError>> {
  const [client] = await db
    .select({
      id: clients.id,
      ownerUserId: clients.ownerUserId,
      kind: clients.kind,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) {
    return err(
      new BadRequestError("clientId does not reference a client in this tenant"),
    );
  }

  if (isAdminRole(actor.role)) {
    return ok(undefined);
  }

  if (client.kind !== "interactive") {
    return err(new ForbiddenError("Members may only use interactive clients"));
  }

  if (client.ownerUserId != null && client.ownerUserId !== actor.userId) {
    return err(new ForbiddenError("You do not own this client"));
  }

  return ok(undefined);
}

async function attachRole(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  roleId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  const rolesCheck = await assertRolesInTenant(tenantId, [roleId]);
  if (rolesCheck.isErr()) return err(rolesCheck.error);

  try {
    await db.insert(connectionRoles).values({
      connectionId,
      roleId,
      tenantId,
    });
  } catch (cause) {
    return err(fromDbWriteError(cause, "Role is already attached to this connection"));
  }

  log.info(
    { connectionId, roleId, tenantId },
    "Connection.services.attachRole",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

async function detachRole(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  roleId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  const [removed] = await db
    .delete(connectionRoles)
    .where(
      and(
        eq(connectionRoles.connectionId, connectionId),
        eq(connectionRoles.roleId, roleId),
        eq(connectionRoles.tenantId, tenantId),
      ),
    )
    .returning({ id: connectionRoles.id });

  if (!removed) {
    return err(new NotFoundError("Connection role binding not found"));
  }

  log.info(
    { connectionId, roleId, tenantId },
    "Connection.services.detachRole",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

async function setRoles(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  roleIds: string[],
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  const uniqueRoleIds = [...new Set(roleIds)];
  const rolesCheck = await assertRolesInTenant(tenantId, uniqueRoleIds);
  if (rolesCheck.isErr()) return err(rolesCheck.error);

  await db.transaction(async (tx) => {
    await tx
      .delete(connectionRoles)
      .where(
        and(
          eq(connectionRoles.connectionId, connectionId),
          eq(connectionRoles.tenantId, tenantId),
        ),
      );

    if (uniqueRoleIds.length > 0) {
      await tx.insert(connectionRoles).values(
        uniqueRoleIds.map((roleId) => ({
          connectionId,
          roleId,
          tenantId,
        })),
      );
    }

    await tx
      .update(connections)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.tenantId, tenantId),
        ),
      );
  });

  log.info(
    { connectionId, tenantId, roleCount: uniqueRoleIds.length },
    "Connection.services.setRoles",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

async function attachToolOverride(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  input: SetToolOverrideInput,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  const toolsCheck = await assertToolsInTenant(tenantId, [input.toolId]);
  if (toolsCheck.isErr()) return err(toolsCheck.error);

  try {
    await db.insert(connectionToolOverrides).values({
      connectionId,
      toolId: input.toolId,
      type: input.type,
      tenantId,
    });
  } catch (cause) {
    return err(fromDbWriteError(cause, "Tool override already exists on this connection"));
  }

  log.info(
    { connectionId, toolId: input.toolId, tenantId },
    "Connection.services.attachToolOverride",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

async function detachToolOverride(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  toolId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  const [removed] = await db
    .delete(connectionToolOverrides)
    .where(
      and(
        eq(connectionToolOverrides.connectionId, connectionId),
        eq(connectionToolOverrides.toolId, toolId),
        eq(connectionToolOverrides.tenantId, tenantId),
      ),
    )
    .returning({ id: connectionToolOverrides.id });

  if (!removed) {
    return err(new NotFoundError("Connection tool override not found"));
  }

  log.info(
    { connectionId, toolId, tenantId },
    "Connection.services.detachToolOverride",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

async function setToolOverrides(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  overrides: SetToolOverrideInput[],
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  const byTool = new Map<string, ConnectionToolOverrideType>();
  for (const override of overrides) {
    byTool.set(override.toolId, override.type);
  }
  const uniqueOverrides = [...byTool.entries()].map(([toolId, type]) => ({
    toolId,
    type,
  }));

  const toolsCheck = await assertToolsInTenant(
    tenantId,
    uniqueOverrides.map((o) => o.toolId),
  );
  if (toolsCheck.isErr()) return err(toolsCheck.error);

  await db.transaction(async (tx) => {
    await tx
      .delete(connectionToolOverrides)
      .where(
        and(
          eq(connectionToolOverrides.connectionId, connectionId),
          eq(connectionToolOverrides.tenantId, tenantId),
        ),
      );

    if (uniqueOverrides.length > 0) {
      await tx.insert(connectionToolOverrides).values(
        uniqueOverrides.map((override) => ({
          connectionId,
          toolId: override.toolId,
          type: override.type,
          tenantId,
        })),
      );
    }

    await tx
      .update(connections)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.tenantId, tenantId),
        ),
      );
  });

  log.info(
    { connectionId, tenantId, overrideCount: uniqueOverrides.length },
    "Connection.services.setToolOverrides",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

function toPublicGatewayCredential(row: SecretRow): PublicGatewayCredential {
  return {
    id: row.id,
    kind: GATEWAY_TOKEN_KIND,
    name: row.name,
    connectionId: row.connectionId!,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function gatewayMcpConfig(token: string): MintedGatewayCredential["mcp"] {
  const configResult = getConfig();
  const url = configResult.isOk()
    ? publicMcpUrl(configResult.value)
    : "http://127.0.0.1:8081/mcp";
  return {
    url,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

async function mintCredential(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  input: { name?: string | undefined } = {},
): Promise<Result<MintedGatewayCredential, MeshError>> {
  const connectionResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const boxResult = getSecretBox();
  if (boxResult.isErr()) return err(boxResult.error);

  const secret = randomBytes(32).toString("base64url");
  const kind = GATEWAY_TOKEN_KIND;
  const name = input.name?.trim() || "Gateway token";
  const binding = {
    serverId: null,
    userId: null,
    connectionId,
  };
  const aad = secretAad({ tenantId, kind, ...binding });
  const encrypted = boxResult.value.encrypt(
    new TextEncoder().encode(secret),
    aad,
  );
  if (encrypted.isErr()) return err(encrypted.error);

  try {
    const [row] = await db
      .insert(secrets)
      .values({
        kind,
        name,
        ciphertext: encrypted.value.ciphertext,
        nonce: encrypted.value.nonce,
        keyVersion: encrypted.value.keyVersion,
        meta: {},
        serverId: null,
        userId: null,
        connectionId,
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to mint gateway credential"));
    }

    const token = formatGatewayToken(row.id, secret);
    const credential = toPublicGatewayCredential(row);

    log.info(
      { connectionId, tenantId, secretId: row.id },
      "Connection.services.mintCredential",
    );

    return ok({
      ...credential,
      token,
      mcp: gatewayMcpConfig(token),
    });
  } catch (cause) {
    return err(
      fromDbWriteError(
        cause,
        "A gateway credential already exists for this connection; revoke it first to rotate",
      ),
    );
  }
}

async function listCredentials(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
): Promise<Result<PublicGatewayCredential[], MeshError>> {
  const connectionResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const rows = await db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.tenantId, tenantId),
        eq(secrets.connectionId, connectionId),
        eq(secrets.kind, GATEWAY_TOKEN_KIND),
        isNull(secrets.serverId),
        isNull(secrets.userId),
      ),
    )
    .orderBy(desc(secrets.createdAt), desc(secrets.id));

  log.debug(
    { connectionId, tenantId, count: rows.length },
    "Connection.services.listCredentials",
  );

  return ok(rows.map(toPublicGatewayCredential));
}

async function revokeCredential(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  secretId: string,
): Promise<Result<PublicGatewayCredential, MeshError>> {
  const connectionResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (connectionResult.isErr()) return err(connectionResult.error);

  const [row] = await db
    .delete(secrets)
    .where(
      and(
        eq(secrets.id, secretId),
        eq(secrets.tenantId, tenantId),
        eq(secrets.connectionId, connectionId),
        eq(secrets.kind, GATEWAY_TOKEN_KIND),
        isNull(secrets.serverId),
        isNull(secrets.userId),
      ),
    )
    .returning();

  if (!row) {
    return err(new NotFoundError("Gateway credential not found"));
  }

  log.info(
    { connectionId, tenantId, secretId },
    "Connection.services.revokeCredential",
  );
  return ok(toPublicGatewayCredential(row));
}

/**
 * Member toggle: turn off / on within admin-granted tools.
 * Role grants: deny override off, delete deny on.
 * Allow-override grants: flip type allow↔deny on the same row.
 */
async function setMemberToolEnabled(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  toolId: string,
  enabled: boolean,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await requireScopedConnection(
    tenantId,
    actor,
    connectionId,
  );
  if (rowResult.isErr()) return err(rowResult.error);

  if (rowResult.value.userId !== actor.userId && !isAdminRole(actor.role)) {
    return err(
      new ForbiddenError("You can only toggle tools on your own connections"),
    );
  }

  const toolsCheck = await assertToolsInTenant(tenantId, [toolId]);
  if (toolsCheck.isErr()) return err(toolsCheck.error);

  const roleIds = await loadRoleIds(tenantId, connectionId);
  let hasRoleGrant = false;
  if (roleIds.length > 0) {
    const grants = await db
      .select({ toolId: roleTools.toolId })
      .from(roleTools)
      .innerJoin(roles, eq(roles.id, roleTools.roleId))
      .where(
        and(
          inArray(roleTools.roleId, roleIds),
          eq(roleTools.toolId, toolId),
          eq(roles.type, "grant"),
        ),
      )
      .limit(1);
    hasRoleGrant = grants.length > 0;
  }

  const [existing] = await db
    .select({
      id: connectionToolOverrides.id,
      type: connectionToolOverrides.type,
    })
    .from(connectionToolOverrides)
    .where(
      and(
        eq(connectionToolOverrides.connectionId, connectionId),
        eq(connectionToolOverrides.tenantId, tenantId),
        eq(connectionToolOverrides.toolId, toolId),
      ),
    )
    .limit(1);

  const hasAllowOrFlipped =
    existing?.type === "allow" || existing?.type === "deny";
  if (!hasRoleGrant && !hasAllowOrFlipped) {
    return err(
      new ForbiddenError("You can only toggle tools an admin has allowed"),
    );
  }
  // Deny-only without role grant means a flipped allow-override — OK.
  // Deny-only shouldn't happen without prior allow for non-role tools.

  if (hasRoleGrant) {
    if (enabled) {
      if (existing?.type === "deny") {
        await db
          .delete(connectionToolOverrides)
          .where(eq(connectionToolOverrides.id, existing.id));
      }
    } else if (existing) {
      await db
        .update(connectionToolOverrides)
        .set({ type: "deny", updatedAt: new Date() })
        .where(eq(connectionToolOverrides.id, existing.id));
    } else {
      await db.insert(connectionToolOverrides).values({
        connectionId,
        toolId,
        type: "deny",
        tenantId,
      });
    }
  } else if (existing) {
    await db
      .update(connectionToolOverrides)
      .set({ type: enabled ? "allow" : "deny", updatedAt: new Date() })
      .where(eq(connectionToolOverrides.id, existing.id));
  } else {
    return err(
      new ForbiddenError("You can only toggle tools an admin has allowed"),
    );
  }

  await db
    .update(connections)
    .set({ updatedAt: new Date() })
    .where(
      and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)),
    );

  log.info(
    { connectionId, toolId, enabled, tenantId },
    "Connection.services.setMemberToolEnabled",
  );
  return ok(await toDetail(tenantId, rowResult.value));
}

export const connectionServices = {
  list,
  create,
  get,
  update,
  delete: remove,
  attachRole,
  detachRole,
  setRoles,
  attachToolOverride,
  detachToolOverride,
  setToolOverrides,
  mintCredential,
  listCredentials,
  revokeCredential,
  setMemberToolEnabled,
} as const;
