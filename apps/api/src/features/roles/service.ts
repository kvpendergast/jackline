import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, roleTools, roles, tools, type Role } from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  JacklineError,
  NotFoundError,
  SetupError,
  type CursorPage,
  type PublicRole,
  type PublicRoleDetail,
  type RoleType,
} from "@jackline/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

export type CreateRoleInput = {
  name: string;
  type: RoleType;
  description?: string | null | undefined;
};

export type UpdateRoleInput = {
  name?: string | undefined;
  type?: RoleType | undefined;
  description?: string | null | undefined;
};

function toPublicRole(row: Role): PublicRole {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    system: row.system,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadToolIds(
  tenantId: string,
  roleId: string,
): Promise<string[]> {
  const rows = await db
    .select({ toolId: roleTools.toolId })
    .from(roleTools)
    .where(and(eq(roleTools.roleId, roleId), eq(roleTools.tenantId, tenantId)));

  return rows.map((row) => row.toolId);
}

async function getRoleRow(
  tenantId: string,
  roleId: string,
): Promise<Result<Role, JacklineError>> {
  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Role not found"));
  }

  return ok(row);
}

async function create(
  log: Logger,
  tenantId: string,
  input: CreateRoleInput,
): Promise<Result<PublicRoleDetail, JacklineError>> {
  try {
    const [row] = await db
      .insert(roles)
      .values({
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create role"));
    }

    log.info({ roleId: row.id, tenantId }, "role created");
    return ok({ ...toPublicRole(row), toolIds: [] });
  } catch (cause) {
    return err(fromDbWriteError(cause, "A role with this name already exists"));
  }
}

async function list(
  log: Logger,
  tenantId: string,
  query: PaginationQuery,
): Promise<Result<CursorPage<PublicRole>, JacklineError>> {
  const conditions = [eq(roles.tenantId, tenantId)];

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) {
      return err(decoded.error);
    }

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(roles.createdAt, createdAt),
        and(eq(roles.createdAt, createdAt), lt(roles.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(roles)
    .where(and(...conditions))
    .orderBy(desc(roles.createdAt), desc(roles.id))
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
    "Role.services.list",
  );

  return ok({
    items: page.items.map(toPublicRole),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  roleId: string,
): Promise<Result<PublicRoleDetail, JacklineError>> {
  const roleResult = await getRoleRow(tenantId, roleId);
  if (roleResult.isErr()) {
    return err(roleResult.error);
  }

  const toolIds = await loadToolIds(tenantId, roleId);
  log.debug({ roleId, tenantId, toolCount: toolIds.length }, "Role.services.get");
  return ok({ ...toPublicRole(roleResult.value), toolIds });
}

async function update(
  log: Logger,
  tenantId: string,
  roleId: string,
  input: UpdateRoleInput,
): Promise<Result<PublicRoleDetail, JacklineError>> {
  const existing = await getRoleRow(tenantId, roleId);
  if (existing.isErr()) {
    return err(existing.error);
  }

  if (existing.value.system) {
    if (input.name !== undefined || input.type !== undefined) {
      return err(
        new ForbiddenError("Cannot change name or type of a system role"),
      );
    }
  }

  const patch: Partial<typeof roles.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.description !== undefined) patch.description = input.description;

  try {
    const [row] = await db
      .update(roles)
      .set(patch)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
      .returning();

    if (!row) {
      return err(new NotFoundError("Role not found"));
    }

    const toolIds = await loadToolIds(tenantId, roleId);
    log.info({ roleId, tenantId }, "Role.services.update");
    return ok({ ...toPublicRole(row), toolIds });
  } catch (cause) {
    return err(fromDbWriteError(cause, "A role with this name already exists"));
  }
}

async function remove(
  log: Logger,
  tenantId: string,
  roleId: string,
): Promise<Result<PublicRole, JacklineError>> {
  const existing = await getRoleRow(tenantId, roleId);
  if (existing.isErr()) {
    return err(existing.error);
  }

  if (existing.value.system) {
    return err(new ForbiddenError("Cannot delete a system role"));
  }

  const [row] = await db
    .delete(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Role not found"));
  }

  log.info({ roleId, tenantId }, "Role.services.delete");
  return ok(toPublicRole(row));
}

async function attachTool(
  log: Logger,
  tenantId: string,
  roleId: string,
  toolId: string,
): Promise<Result<PublicRoleDetail, JacklineError>> {
  const roleResult = await getRoleRow(tenantId, roleId);
  if (roleResult.isErr()) {
    return err(roleResult.error);
  }

  const [tool] = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.id, toolId), eq(tools.tenantId, tenantId)))
    .limit(1);

  if (!tool) {
    return err(
      new BadRequestError("toolId does not reference a tool in this tenant"),
    );
  }

  try {
    await db.insert(roleTools).values({ roleId, toolId, tenantId });
  } catch (cause) {
    return err(fromDbWriteError(cause, "Tool is already attached to this role"));
  }

  const toolIds = await loadToolIds(tenantId, roleId);
  log.info({ roleId, toolId, tenantId }, "Role.services.attachTool");
  return ok({ ...toPublicRole(roleResult.value), toolIds });
}

async function detachTool(
  log: Logger,
  tenantId: string,
  roleId: string,
  toolId: string,
): Promise<Result<PublicRoleDetail, JacklineError>> {
  const roleResult = await getRoleRow(tenantId, roleId);
  if (roleResult.isErr()) {
    return err(roleResult.error);
  }

  const [removed] = await db
    .delete(roleTools)
    .where(
      and(
        eq(roleTools.roleId, roleId),
        eq(roleTools.toolId, toolId),
        eq(roleTools.tenantId, tenantId),
      ),
    )
    .returning({ id: roleTools.id });

  if (!removed) {
    return err(new NotFoundError("Role tool binding not found"));
  }

  const toolIds = await loadToolIds(tenantId, roleId);
  log.info({ roleId, toolId, tenantId }, "Role.services.detachTool");
  return ok({ ...toPublicRole(roleResult.value), toolIds });
}

async function setTools(
  log: Logger,
  tenantId: string,
  roleId: string,
  toolIds: string[],
): Promise<Result<PublicRoleDetail, JacklineError>> {
  const roleResult = await getRoleRow(tenantId, roleId);
  if (roleResult.isErr()) {
    return err(roleResult.error);
  }

  const uniqueToolIds = [...new Set(toolIds)];

  if (uniqueToolIds.length > 0) {
    const found = await db
      .select({ id: tools.id })
      .from(tools)
      .where(
        and(eq(tools.tenantId, tenantId), inArray(tools.id, uniqueToolIds)),
      );

    if (found.length !== uniqueToolIds.length) {
      return err(
        new BadRequestError(
          "One or more toolIds do not reference tools in this tenant",
        ),
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(roleTools)
      .where(
        and(eq(roleTools.roleId, roleId), eq(roleTools.tenantId, tenantId)),
      );

    if (uniqueToolIds.length > 0) {
      await tx.insert(roleTools).values(
        uniqueToolIds.map((toolId) => ({
          roleId,
          toolId,
          tenantId,
        })),
      );
    }

    await tx
      .update(roles)
      .set({ updatedAt: new Date() })
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  });

  log.info(
    { roleId, tenantId, toolCount: uniqueToolIds.length },
    "Role.services.setTools",
  );
  return ok({ ...toPublicRole(roleResult.value), toolIds: uniqueToolIds });
}

export const roleServices = {
  list,
  create,
  get,
  update,
  delete: remove,
  attachTool,
  setTools,
  detachTool,
} as const;
