import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
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
  tools,
  user,
  type Connection as ConnectionRow,
} from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  SetupError,
  type ConnectionStatus,
  type ConnectionToolOverrideType,
  type CursorPage,
  type PublicConnection,
  type PublicConnectionDetail,
  type PublicConnectionToolOverride,
} from "@mesh/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

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

async function assertClientInTenant(
  tenantId: string,
  clientId: string,
): Promise<Result<void, MeshError>> {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!client) {
    return err(
      new BadRequestError("clientId does not reference a client in this tenant"),
    );
  }

  return ok(undefined);
}

async function assertUserInTenant(
  tenantId: string,
  userId: string,
): Promise<Result<void, MeshError>> {
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!existingUser) {
    return err(new BadRequestError("userId does not reference a user"));
  }

  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)),
    )
    .limit(1);

  if (!membership) {
    return err(new BadRequestError("userId is not a member of this tenant"));
  }

  return ok(undefined);
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
  input: CreateConnectionInput,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const clientCheck = await assertClientInTenant(tenantId, input.clientId);
  if (clientCheck.isErr()) return err(clientCheck.error);

  const userCheck = await assertUserInTenant(tenantId, input.userId);
  if (userCheck.isErr()) return err(userCheck.error);

  try {
    const [row] = await db
      .insert(connections)
      .values({
        clientId: input.clientId,
        userId: input.userId,
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
  query: ListConnectionsQuery,
): Promise<Result<CursorPage<PublicConnection>, MeshError>> {
  const conditions = [eq(connections.tenantId, tenantId)];

  if (query.clientId) conditions.push(eq(connections.clientId, query.clientId));
  if (query.userId) conditions.push(eq(connections.userId, query.userId));
  if (query.status) conditions.push(eq(connections.status, query.status));

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

  const rows = await db
    .select()
    .from(connections)
    .where(and(...conditions))
    .orderBy(desc(connections.createdAt), desc(connections.id))
    .limit(query.limit + 1);

  const page = toCursorPage(rows, query.limit, (row) =>
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
  connectionId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
  if (rowResult.isErr()) return err(rowResult.error);

  log.debug({ connectionId, tenantId }, "Connection.services.get");
  return ok(await toDetail(tenantId, rowResult.value));
}

async function update(
  log: Logger,
  tenantId: string,
  connectionId: string,
  input: UpdateConnectionInput,
): Promise<Result<PublicConnectionDetail, MeshError>> {
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
  connectionId: string,
): Promise<Result<PublicConnection, MeshError>> {
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

async function attachRole(
  log: Logger,
  tenantId: string,
  connectionId: string,
  roleId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
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
  connectionId: string,
  roleId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
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
  connectionId: string,
  roleIds: string[],
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
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
  connectionId: string,
  input: SetToolOverrideInput,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
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
  connectionId: string,
  toolId: string,
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
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
  connectionId: string,
  overrides: SetToolOverrideInput[],
): Promise<Result<PublicConnectionDetail, MeshError>> {
  const rowResult = await getConnectionRow(tenantId, connectionId);
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
} as const;
