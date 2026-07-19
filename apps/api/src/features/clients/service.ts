import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, clients, type Client as ClientRow } from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  SetupError,
  type ClientKind,
  type CursorPage,
  type PublicClient,
} from "@mesh/shared";
import { isUniqueViolation } from "../../lib/db/isUniqueViolation.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

export type CreateClientInput = {
  name: string;
  kind: ClientKind;
};

export type UpdateClientInput = {
  name?: string | undefined;
  kind?: ClientKind | undefined;
};

export type ListClientsQuery = PaginationQuery & {
  kind?: ClientKind | undefined;
};

function toPublicClient(row: ClientRow): PublicClient {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function create(
  log: Logger,
  tenantId: string,
  input: CreateClientInput,
): Promise<Result<PublicClient, MeshError>> {
  try {
    const [row] = await db
      .insert(clients)
      .values({
        name: input.name,
        kind: input.kind,
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create client"));
    }

    log.info({ clientId: row.id, tenantId }, "Client.services.create");
    return ok(toPublicClient(row));
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return err(new BadRequestError("A client with this name already exists"));
    }
    throw cause;
  }
}

async function list(
  log: Logger,
  tenantId: string,
  query: ListClientsQuery,
): Promise<Result<CursorPage<PublicClient>, MeshError>> {
  const conditions = [eq(clients.tenantId, tenantId)];

  if (query.kind) {
    conditions.push(eq(clients.kind, query.kind));
  }

  if (query.cursor) {
    const decoded = decodeCreatedAtIdCursor(query.cursor);
    if (decoded.isErr()) {
      return err(decoded.error);
    }

    const createdAt = new Date(decoded.value.createdAt);
    const { id } = decoded.value;
    conditions.push(
      or(
        lt(clients.createdAt, createdAt),
        and(eq(clients.createdAt, createdAt), lt(clients.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(clients)
    .where(and(...conditions))
    .orderBy(desc(clients.createdAt), desc(clients.id))
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
      kind: query.kind,
      count: page.items.length,
      hasMore: page.nextCursor !== null,
    },
    "Client.services.list",
  );

  return ok({
    items: page.items.map(toPublicClient),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  clientId: string,
): Promise<Result<PublicClient, MeshError>> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Client not found"));
  }

  log.debug({ clientId, tenantId }, "Client.services.get");
  return ok(toPublicClient(row));
}

async function update(
  log: Logger,
  tenantId: string,
  clientId: string,
  input: UpdateClientInput,
): Promise<Result<PublicClient, MeshError>> {
  const patch: Partial<typeof clients.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.kind !== undefined) patch.kind = input.kind;

  try {
    const [row] = await db
      .update(clients)
      .set(patch)
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
      .returning();

    if (!row) {
      return err(new NotFoundError("Client not found"));
    }

    log.info({ clientId, tenantId }, "Client.services.update");
    return ok(toPublicClient(row));
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return err(new BadRequestError("A client with this name already exists"));
    }
    throw cause;
  }
}

async function remove(
  log: Logger,
  tenantId: string,
  clientId: string,
): Promise<Result<PublicClient, MeshError>> {
  const [row] = await db
    .delete(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Client not found"));
  }

  log.info({ clientId, tenantId }, "Client.services.delete");
  return ok(toPublicClient(row));
}

export const clientServices = {
  list,
  create,
  get,
  update,
  delete: remove,
} as const;
