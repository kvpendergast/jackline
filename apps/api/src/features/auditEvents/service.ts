import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  auditEvents,
  db,
  type AuditEvent as AuditEventRow,
} from "@mesh/db";
import {
  MeshError,
  NotFoundError,
  type AuditOutcome,
  type CursorPage,
  type PublicAuditEvent,
} from "@mesh/shared";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

export type ListAuditEventsQuery = PaginationQuery & {
  connectionId?: string | undefined;
  clientId?: string | undefined;
  userId?: string | undefined;
  toolId?: string | undefined;
  serverId?: string | undefined;
  outcome?: AuditOutcome | undefined;
};

function toPublicAuditEvent(row: AuditEventRow): PublicAuditEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    clientId: row.clientId,
    userId: row.userId,
    toolId: row.toolId,
    toolName: row.toolName,
    serverId: row.serverId,
    outcome: row.outcome,
    reason: row.reason,
    requestId: row.requestId,
    latencyMs: row.latencyMs,
    requestArgs: row.requestArgs ?? null,
    responseBody: row.responseBody ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function list(
  log: Logger,
  tenantId: string,
  query: ListAuditEventsQuery,
): Promise<Result<CursorPage<PublicAuditEvent>, MeshError>> {
  const conditions = [eq(auditEvents.tenantId, tenantId)];

  if (query.connectionId) {
    conditions.push(eq(auditEvents.connectionId, query.connectionId));
  }
  if (query.clientId) {
    conditions.push(eq(auditEvents.clientId, query.clientId));
  }
  if (query.userId) {
    conditions.push(eq(auditEvents.userId, query.userId));
  }
  if (query.toolId) {
    conditions.push(eq(auditEvents.toolId, query.toolId));
  }
  if (query.serverId) {
    conditions.push(eq(auditEvents.serverId, query.serverId));
  }
  if (query.outcome) {
    conditions.push(eq(auditEvents.outcome, query.outcome));
  }

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) return err(decoded.error);

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(auditEvents.createdAt, createdAt),
        and(eq(auditEvents.createdAt, createdAt), lt(auditEvents.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
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
    "AuditEvent.services.list",
  );

  return ok({
    items: page.items.map(toPublicAuditEvent),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  eventId: string,
): Promise<Result<PublicAuditEvent, MeshError>> {
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.id, eventId), eq(auditEvents.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Audit event not found"));
  }

  log.debug({ eventId, tenantId }, "AuditEvent.services.get");
  return ok(toPublicAuditEvent(row));
}

export const auditEventServices = {
  list,
  get,
} as const;
