import { and, desc, eq, lt, or } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { db, servers, tools, type Tool } from "@mesh/db";
import {
  BadRequestError,
  MeshError,
  NotFoundError,
  SetupError,
  type CursorPage,
  type PublicTool,
  type ToolHttpMethod,
  type ToolStatus,
} from "@mesh/shared";
import { fromDbWriteError } from "../../lib/db/fromDbWriteError.js";
import {
  decodeCreatedAtIdCursor,
  encodeCreatedAtIdCursor,
  toCursorPage,
  type PaginationQuery,
} from "../../lib/http/pagination.js";

export type CreateToolInput = {
  name: string;
  serverId: string;
  status?: ToolStatus | undefined;
  description?: string | null | undefined;
  inputSchema?: Record<string, unknown> | null | undefined;
  httpMethod?: ToolHttpMethod | null | undefined;
  pathTemplate?: string | null | undefined;
};

export type UpdateToolInput = {
  name?: string | undefined;
  status?: ToolStatus | undefined;
  description?: string | null | undefined;
  inputSchema?: Record<string, unknown> | null | undefined;
  httpMethod?: ToolHttpMethod | null | undefined;
  pathTemplate?: string | null | undefined;
};

export type ListToolsQuery = PaginationQuery & {
  serverId?: string | undefined;
};

function toPublicTool(row: Tool): PublicTool {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: row.inputSchema,
    httpMethod: row.httpMethod,
    pathTemplate: row.pathTemplate,
    status: row.status,
    serverId: row.serverId,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertServerInTenant(
  tenantId: string,
  serverId: string,
): Promise<Result<{ kind: string }, MeshError>> {
  const [server] = await db
    .select({ id: servers.id, kind: servers.kind })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.tenantId, tenantId)))
    .limit(1);

  if (!server) {
    return err(new BadRequestError("serverId does not reference a server in this tenant"));
  }

  return ok(server);
}

function validateHttpBinding(
  serverKind: string,
  httpMethod: ToolHttpMethod | null | undefined,
  pathTemplate: string | null | undefined,
): Result<void, MeshError> {
  const hasMethod = httpMethod != null;
  const hasPath = pathTemplate != null && pathTemplate !== "";
  if (hasMethod !== hasPath) {
    return err(
      new BadRequestError("httpMethod and pathTemplate must be set together"),
    );
  }
  if (serverKind === "api" && !hasMethod) {
    return err(
      new BadRequestError("API tools require httpMethod and pathTemplate"),
    );
  }
  if (serverKind === "mcp" && hasMethod) {
    return err(
      new BadRequestError("MCP tools cannot have httpMethod/pathTemplate"),
    );
  }
  return ok(undefined);
}

async function create(
  log: Logger,
  tenantId: string,
  input: CreateToolInput,
): Promise<Result<PublicTool, MeshError>> {
  const serverCheck = await assertServerInTenant(tenantId, input.serverId);
  if (serverCheck.isErr()) {
    return err(serverCheck.error);
  }

  const binding = validateHttpBinding(
    serverCheck.value.kind,
    input.httpMethod,
    input.pathTemplate,
  );
  if (binding.isErr()) return err(binding.error);

  try {
    const [row] = await db
      .insert(tools)
      .values({
        name: input.name,
        description: input.description ?? null,
        inputSchema: input.inputSchema ?? null,
        httpMethod: input.httpMethod ?? null,
        pathTemplate: input.pathTemplate ?? null,
        serverId: input.serverId,
        status: input.status ?? "needs_review",
        tenantId,
      })
      .returning();

    if (!row) {
      return err(new SetupError("Failed to create tool"));
    }

    log.info(
      { toolId: row.id, serverId: row.serverId, tenantId },
      "tool created",
    );
    return ok(toPublicTool(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "A tool with this name already exists on the server"));
  }
}

async function list(
  log: Logger,
  tenantId: string,
  query: ListToolsQuery,
): Promise<Result<CursorPage<PublicTool>, MeshError>> {
  const conditions = [eq(tools.tenantId, tenantId)];

  if (query.serverId) {
    conditions.push(eq(tools.serverId, query.serverId));
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
        lt(tools.createdAt, createdAt),
        and(eq(tools.createdAt, createdAt), lt(tools.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(tools)
    .where(and(...conditions))
    .orderBy(desc(tools.createdAt), desc(tools.id))
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
      serverId: query.serverId,
      count: page.items.length,
      hasMore: page.nextCursor !== null,
    },
    "listTools",
  );

  return ok({
    items: page.items.map(toPublicTool),
    nextCursor: page.nextCursor,
  });
}

async function get(
  log: Logger,
  tenantId: string,
  toolId: string,
): Promise<Result<PublicTool, MeshError>> {
  const [row] = await db
    .select()
    .from(tools)
    .where(and(eq(tools.id, toolId), eq(tools.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return err(new NotFoundError("Tool not found"));
  }

  log.debug({ toolId, tenantId }, "getTool");
  return ok(toPublicTool(row));
}

async function update(
  log: Logger,
  tenantId: string,
  toolId: string,
  input: UpdateToolInput,
): Promise<Result<PublicTool, MeshError>> {
  const [existing] = await db
    .select({
      id: tools.id,
      serverId: tools.serverId,
      httpMethod: tools.httpMethod,
      pathTemplate: tools.pathTemplate,
      kind: servers.kind,
    })
    .from(tools)
    .innerJoin(servers, eq(servers.id, tools.serverId))
    .where(and(eq(tools.id, toolId), eq(tools.tenantId, tenantId)))
    .limit(1);

  if (!existing) {
    return err(new NotFoundError("Tool not found"));
  }

  const nextMethod =
    input.httpMethod !== undefined ? input.httpMethod : existing.httpMethod;
  const nextPath =
    input.pathTemplate !== undefined ? input.pathTemplate : existing.pathTemplate;

  const binding = validateHttpBinding(existing.kind, nextMethod, nextPath);
  if (binding.isErr()) return err(binding.error);

  const patch: Partial<typeof tools.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) patch.name = input.name;
  if (input.status !== undefined) patch.status = input.status;
  if (input.description !== undefined) patch.description = input.description;
  if (input.inputSchema !== undefined) patch.inputSchema = input.inputSchema;
  if (input.httpMethod !== undefined) patch.httpMethod = input.httpMethod;
  if (input.pathTemplate !== undefined) patch.pathTemplate = input.pathTemplate;

  try {
    const [row] = await db
      .update(tools)
      .set(patch)
      .where(and(eq(tools.id, toolId), eq(tools.tenantId, tenantId)))
      .returning();

    if (!row) {
      return err(new NotFoundError("Tool not found"));
    }

    log.info({ toolId, tenantId }, "tool updated");
    return ok(toPublicTool(row));
  } catch (cause) {
    return err(fromDbWriteError(cause, "A tool with this name already exists on the server"));
  }
}

async function remove(
  log: Logger,
  tenantId: string,
  toolId: string,
): Promise<Result<PublicTool, MeshError>> {
  const [row] = await db
    .delete(tools)
    .where(and(eq(tools.id, toolId), eq(tools.tenantId, tenantId)))
    .returning();

  if (!row) {
    return err(new NotFoundError("Tool not found"));
  }

  log.info({ toolId, tenantId }, "tool deleted");
  return ok(toPublicTool(row));
}

export const toolServices = {
  list,
  create,
  get,
  update,
  delete: remove,
} as const;
