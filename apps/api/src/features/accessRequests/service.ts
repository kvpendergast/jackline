import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  accessRequests,
  connectionToolOverrides,
  connections,
  db,
  memberships,
  notifications,
  servers,
  tools,
  type AccessRequest as AccessRequestRow,
} from "@mesh/db";
import {
  BadRequestError,
  ForbiddenError,
  MeshError,
  NotFoundError,
  SetupError,
  type PublicAccessRequest,
  type PublicNotification,
} from "@mesh/shared";
import {
  isAdminRole,
  resolveTeamFilter,
  type ActorAuthz,
} from "../../lib/authz/teamScope.js";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";

function toPublicAccessRequest(row: AccessRequestRow): PublicAccessRequest {
  return {
    id: row.id,
    status: row.status,
    serverId: row.serverId,
    connectionId: row.connectionId,
    requesterUserId: row.requesterUserId,
    decidedByUserId: row.decidedByUserId ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote ?? null,
    approvedToolIds: row.approvedToolIds ?? null,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function createNotification(input: {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(notifications).values({
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    href: input.href ?? null,
    meta: input.meta ?? null,
  });
}

async function notifyApprovers(
  tenantId: string,
  requesterUserId: string,
  requestId: string,
  serverName: string,
): Promise<void> {
  const [requesterMembership] = await db
    .select({ team: memberships.team })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, requesterUserId),
      ),
    )
    .limit(1);

  const requesterTeam = requesterMembership?.team ?? null;

  const admins = await db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      team: memberships.team,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        or(
          eq(memberships.role, "full_admin"),
          eq(memberships.role, "delegated_admin"),
        ),
      ),
    );

  for (const admin of admins) {
    if (admin.role === "delegated_admin") {
      if (!requesterTeam || admin.team !== requesterTeam) continue;
    }
    await createNotification({
      tenantId,
      userId: admin.userId,
      type: "access_request.pending",
      title: "Access request pending",
      body: `A member requested access to ${serverName}.`,
      href: `/access-requests`,
      meta: { requestId, serverName },
    });
  }
}

async function grantAllowOverrides(
  tenantId: string,
  connectionId: string,
  toolIds: string[],
): Promise<Result<void, MeshError>> {
  if (toolIds.length === 0) return ok(undefined);

  try {
    for (const toolId of toolIds) {
      const [existing] = await db
        .select({ id: connectionToolOverrides.id })
        .from(connectionToolOverrides)
        .where(
          and(
            eq(connectionToolOverrides.connectionId, connectionId),
            eq(connectionToolOverrides.toolId, toolId),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(connectionToolOverrides)
          .set({ type: "allow", updatedAt: new Date() })
          .where(eq(connectionToolOverrides.id, existing.id));
      } else {
        await db.insert(connectionToolOverrides).values({
          tenantId,
          connectionId,
          toolId,
          type: "allow",
        });
      }
    }
    await db
      .update(connections)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(connections.id, connectionId),
          eq(connections.tenantId, tenantId),
        ),
      );
    return ok(undefined);
  } catch (cause) {
    return err(fromDbWriteError(cause, "Failed to grant tool access"));
  }
}

/** Auto-attach tools that do not require approval (server must be auto-allow or already granted via prior approval). */
async function attachAutoAllowedTools(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  connectionId: string,
  serverId: string,
): Promise<Result<{ attachedToolIds: string[] }, MeshError>> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, connectionId),
        eq(connections.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    return err(new NotFoundError("Connection not found"));
  }
  if (connection.userId !== actor.userId && !isAdminRole(actor.role)) {
    return err(new ForbiddenError("You can only modify your own connections"));
  }
  if (isAdminRole(actor.role) && connection.userId !== actor.userId) {
    const teamResult = resolveTeamFilter(actor);
    if (teamResult.isErr()) return err(teamResult.error);
    if (teamResult.value) {
      const [subject] = await db
        .select({ team: memberships.team })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.userId, connection.userId),
          ),
        )
        .limit(1);
      if (!subject || subject.team !== teamResult.value) {
        return err(new ForbiddenError("user is outside your team scope"));
      }
    }
  }

  const [server] = await db
    .select()
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!server) {
    return err(new NotFoundError("Server not found"));
  }
  if (server.status !== "active") {
    return err(new BadRequestError("Server is not active"));
  }
  if (server.requiresApproval) {
    return err(
      new BadRequestError(
        "Server requires approval — create an access request instead",
      ),
    );
  }

  const autoTools = await db
    .select({ id: tools.id })
    .from(tools)
    .where(
      and(
        eq(tools.tenantId, tenantId),
        eq(tools.serverId, serverId),
        eq(tools.status, "active"),
        eq(tools.requiresApproval, false),
      ),
    );

  const toolIds = autoTools.map((t) => t.id);
  const grant = await grantAllowOverrides(tenantId, connectionId, toolIds);
  if (grant.isErr()) return err(grant.error);

  log.info(
    { connectionId, serverId, count: toolIds.length, tenantId },
    "AccessRequest.services.attachAutoAllowedTools",
  );
  return ok({ attachedToolIds: toolIds });
}

async function createRequest(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  input: { connectionId: string; serverId: string },
): Promise<Result<PublicAccessRequest, MeshError>> {
  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, input.connectionId),
        eq(connections.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!connection) {
    return err(new NotFoundError("Connection not found"));
  }
  if (connection.userId !== actor.userId) {
    return err(new ForbiddenError("You can only request access for your own connections"));
  }

  const [server] = await db
    .select()
    .from(servers)
    .where(
      and(eq(servers.id, input.serverId), eq(servers.tenantId, tenantId)),
    )
    .limit(1);

  if (!server) {
    return err(new NotFoundError("Server not found"));
  }
  if (server.status !== "active") {
    return err(new BadRequestError("Server is not active"));
  }

  const needsRequest =
    server.requiresApproval ||
    (
      await db
        .select({ id: tools.id })
        .from(tools)
        .where(
          and(
            eq(tools.tenantId, tenantId),
            eq(tools.serverId, server.id),
            eq(tools.status, "active"),
            eq(tools.requiresApproval, true),
          ),
        )
        .limit(1)
    ).length > 0;

  if (!needsRequest) {
    return err(
      new BadRequestError(
        "Server and tools are auto-allowed — attach them instead of requesting",
      ),
    );
  }

  const [existing] = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(
      and(
        eq(accessRequests.tenantId, tenantId),
        eq(accessRequests.connectionId, input.connectionId),
        eq(accessRequests.serverId, input.serverId),
        eq(accessRequests.status, "pending"),
      ),
    )
    .limit(1);

  if (existing) {
    return err(new BadRequestError("A pending request already exists for this server"));
  }

  try {
    const [row] = await db
      .insert(accessRequests)
      .values({
        tenantId,
        connectionId: input.connectionId,
        serverId: input.serverId,
        requesterUserId: actor.userId,
        status: "pending",
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create access request"));
    }

    await notifyApprovers(tenantId, actor.userId, row.id, server.name);

    log.info(
      { requestId: row.id, serverId: server.id, tenantId },
      "AccessRequest.services.create",
    );
    return ok(toPublicAccessRequest(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "Failed to create access request"));
  }
}

async function listRequests(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  query: { status?: string | undefined },
): Promise<Result<{ items: PublicAccessRequest[] }, MeshError>> {
  const conditions = [eq(accessRequests.tenantId, tenantId)];
  if (query.status) {
    conditions.push(
      eq(
        accessRequests.status,
        query.status as AccessRequestRow["status"],
      ),
    );
  }

  if (!isAdminRole(actor.role)) {
    conditions.push(eq(accessRequests.requesterUserId, actor.userId));
  } else if (actor.role === "delegated_admin") {
    const teamResult = resolveTeamFilter(actor);
    if (teamResult.isErr()) return err(teamResult.error);
    const team = teamResult.value!;
    const teamUserIds = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(eq(memberships.tenantId, tenantId), eq(memberships.team, team)),
      );
    const ids = teamUserIds.map((r) => r.userId);
    if (ids.length === 0) {
      return ok({ items: [] });
    }
    conditions.push(inArray(accessRequests.requesterUserId, ids));
  }

  const rows = await db
    .select()
    .from(accessRequests)
    .where(and(...conditions))
    .orderBy(desc(accessRequests.createdAt))
    .limit(100);

  log.debug({ tenantId, count: rows.length }, "AccessRequest.services.list");
  return ok({ items: rows.map(toPublicAccessRequest) });
}

async function assertCanDecide(
  tenantId: string,
  actor: ActorAuthz,
  requesterUserId: string,
): Promise<Result<void, MeshError>> {
  if (!isAdminRole(actor.role)) {
    return err(new ForbiddenError("admin role required"));
  }
  if (actor.role === "full_admin") return ok(undefined);

  const teamResult = resolveTeamFilter(actor);
  if (teamResult.isErr()) return err(teamResult.error);

  const [subject] = await db
    .select({ team: memberships.team })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, requesterUserId),
      ),
    )
    .limit(1);

  if (!subject || subject.team !== teamResult.value) {
    return err(new ForbiddenError("request is outside your team scope"));
  }
  return ok(undefined);
}

async function approveRequest(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  requestId: string,
  input: { toolIds?: string[] | null | undefined; note?: string | null | undefined },
): Promise<Result<PublicAccessRequest, MeshError>> {
  const [row] = await db
    .select()
    .from(accessRequests)
    .where(
      and(eq(accessRequests.id, requestId), eq(accessRequests.tenantId, tenantId)),
    )
    .limit(1);

  if (!row) return err(new NotFoundError("Access request not found"));
  if (row.status !== "pending") {
    return err(new BadRequestError("Request is not pending"));
  }

  const allowed = await assertCanDecide(tenantId, actor, row.requesterUserId);
  if (allowed.isErr()) return err(allowed.error);

  let toolIds = input.toolIds ?? null;
  if (toolIds === null || toolIds === undefined) {
    const allActive = await db
      .select({ id: tools.id })
      .from(tools)
      .where(
        and(
          eq(tools.tenantId, tenantId),
          eq(tools.serverId, row.serverId),
          eq(tools.status, "active"),
        ),
      );
    toolIds = allActive.map((t) => t.id);
  } else {
    const found = await db
      .select({ id: tools.id })
      .from(tools)
      .where(
        and(
          eq(tools.tenantId, tenantId),
          eq(tools.serverId, row.serverId),
          inArray(tools.id, toolIds),
        ),
      );
    if (found.length !== toolIds.length) {
      return err(
        new BadRequestError("One or more tools are not on the requested server"),
      );
    }
  }

  const grant = await grantAllowOverrides(tenantId, row.connectionId, toolIds);
  if (grant.isErr()) return err(grant.error);

  const [updated] = await db
    .update(accessRequests)
    .set({
      status: "approved",
      decidedByUserId: actor.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
      approvedToolIds: toolIds,
      updatedAt: new Date(),
    })
    .where(eq(accessRequests.id, requestId))
    .returning();

  if (!updated) {
    return err(new SetupError("Failed to approve request"));
  }

  await createNotification({
    tenantId,
    userId: row.requesterUserId,
    type: "access_request.approved",
    title: "Access request approved",
    body: `Your access request was approved (${toolIds.length} tool${toolIds.length === 1 ? "" : "s"}).`,
    href: `/connections/${row.connectionId}`,
    meta: { requestId, toolIds },
  });

  log.info({ requestId, tenantId, toolCount: toolIds.length }, "AccessRequest.approve");
  return ok(toPublicAccessRequest(updated));
}

async function denyRequest(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  requestId: string,
  input: { note?: string | null | undefined },
): Promise<Result<PublicAccessRequest, MeshError>> {
  const [row] = await db
    .select()
    .from(accessRequests)
    .where(
      and(eq(accessRequests.id, requestId), eq(accessRequests.tenantId, tenantId)),
    )
    .limit(1);

  if (!row) return err(new NotFoundError("Access request not found"));
  if (row.status !== "pending") {
    return err(new BadRequestError("Request is not pending"));
  }

  const allowed = await assertCanDecide(tenantId, actor, row.requesterUserId);
  if (allowed.isErr()) return err(allowed.error);

  const [updated] = await db
    .update(accessRequests)
    .set({
      status: "denied",
      decidedByUserId: actor.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(accessRequests.id, requestId))
    .returning();

  if (!updated) {
    return err(new SetupError("Failed to deny request"));
  }

  await createNotification({
    tenantId,
    userId: row.requesterUserId,
    type: "access_request.denied",
    title: "Access request denied",
    body: input.note?.trim() || "Your access request was denied.",
    href: `/connections/${row.connectionId}`,
    meta: { requestId },
  });

  log.info({ requestId, tenantId }, "AccessRequest.deny");
  return ok(toPublicAccessRequest(updated));
}

async function cancelRequest(
  log: Logger,
  tenantId: string,
  actor: ActorAuthz,
  requestId: string,
): Promise<Result<PublicAccessRequest, MeshError>> {
  const [row] = await db
    .select()
    .from(accessRequests)
    .where(
      and(eq(accessRequests.id, requestId), eq(accessRequests.tenantId, tenantId)),
    )
    .limit(1);

  if (!row) return err(new NotFoundError("Access request not found"));
  if (row.status !== "pending") {
    return err(new BadRequestError("Request is not pending"));
  }
  if (row.requesterUserId !== actor.userId && !isAdminRole(actor.role)) {
    return err(new ForbiddenError("You can only cancel your own requests"));
  }

  const [updated] = await db
    .update(accessRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(accessRequests.id, requestId))
    .returning();

  if (!updated) {
    return err(new SetupError("Failed to cancel request"));
  }

  log.info({ requestId, tenantId }, "AccessRequest.cancel");
  return ok(toPublicAccessRequest(updated));
}

function toPublicNotification(
  row: typeof notifications.$inferSelect,
): PublicNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listNotifications(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<{ items: PublicNotification[]; unreadCount: number }, MeshError>> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const unreadCount = rows.filter((r) => r.readAt == null).length;
  log.debug({ tenantId, count: rows.length }, "Notification.services.list");
  return ok({ items: rows.map(toPublicNotification), unreadCount });
}

async function markNotificationRead(
  log: Logger,
  tenantId: string,
  userId: string,
  notificationId: string,
): Promise<Result<PublicNotification, MeshError>> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
      ),
    )
    .returning();

  if (!row) return err(new NotFoundError("Notification not found"));
  log.info({ notificationId, tenantId }, "Notification.markRead");
  return ok(toPublicNotification(row));
}

async function markAllNotificationsRead(
  log: Logger,
  tenantId: string,
  userId: string,
): Promise<Result<{ updated: number }, MeshError>> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  log.info({ tenantId, updated: rows.length }, "Notification.markAllRead");
  return ok({ updated: rows.length });
}

export const accessRequestServices = {
  create: createRequest,
  list: listRequests,
  approve: approveRequest,
  deny: denyRequest,
  cancel: cancelRequest,
  attachAutoAllowedTools,
} as const;

export const notificationServices = {
  list: listNotifications,
  markRead: markNotificationRead,
  markAllRead: markAllNotificationsRead,
} as const;
