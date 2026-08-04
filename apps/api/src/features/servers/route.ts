import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicServerSchema,
  ServerAuthMethodSchema,
  ServerCredentialModeSchema,
  ServerKindSchema,
  ServerSourceSchema,
  ServerStatusSchema,
  SyncToolsResultSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const ServerIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("ServerIdParam");

const CreateServerBodySchema = z
  .strictObject({
    name: z.string().min(1),
    baseUrl: z.url(),
    authMethod: ServerAuthMethodSchema,
    kind: ServerKindSchema,
    source: ServerSourceSchema.optional(),
    credentialMode: ServerCredentialModeSchema.optional(),
    connectorKey: z.string().min(1).nullable().optional(),
    docsUrl: z.url().nullable().optional(),
  })
  .openapi("CreateServerBody");

const UpdateServerBodySchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    baseUrl: z.url().optional(),
    authMethod: ServerAuthMethodSchema.optional(),
    kind: ServerKindSchema.optional(),
    source: ServerSourceSchema.optional(),
    status: ServerStatusSchema.optional(),
    credentialMode: ServerCredentialModeSchema.optional(),
    connectorKey: z.string().min(1).nullable().optional(),
    docsUrl: z.url().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .openapi("UpdateServerBody");

const ServerResponseSchema = successEnvelopeSchema(
  PublicServerSchema,
  "ServerResponse",
);

const ServerListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicServerSchema),
  "ServerListResponse",
);

const serverNotFound = notFoundError("Server not found");

const list = createRoute({
  method: "get",
  path: "/servers",
  tags: ["Servers"],
  summary: "List servers for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of servers (newest first)",
      content: {
        "application/json": { schema: ServerListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/servers",
  tags: ["Servers"],
  summary: "Create a server",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateServerBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Server created",
      content: {
        "application/json": { schema: ServerResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/servers/{id}",
  tags: ["Servers"],
  summary: "Get a server by id",
  request: {
    headers: TenantIdHeaderSchema,
    params: ServerIdParamSchema,
  },
  responses: {
    200: {
      description: "Server",
      content: {
        "application/json": { schema: ServerResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...serverNotFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/servers/{id}",
  tags: ["Servers"],
  summary: "Update a server",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ServerIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateServerBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Server updated",
      content: {
        "application/json": { schema: ServerResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...serverNotFound,
  },
});

const remove = createRoute({
  method: "delete",
  path: "/servers/{id}",
  tags: ["Servers"],
  summary: "Delete a server",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ServerIdParamSchema,
  },
  responses: {
    200: {
      description: "Server deleted",
      content: {
        "application/json": { schema: ServerResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...serverNotFound,
  },
});

const SyncToolsResponseSchema = successEnvelopeSchema(
  SyncToolsResultSchema,
  "SyncToolsResponse",
);

const syncTools = createRoute({
  method: "post",
  path: "/servers/{id}/sync-tools",
  tags: ["Servers"],
  summary: "Discover tools from upstream MCP tools/list or OpenAPI docsUrl",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ServerIdParamSchema,
  },
  responses: {
    200: {
      description: "Sync result",
      content: {
        "application/json": { schema: SyncToolsResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...serverNotFound,
  },
});

export const serverRoutes = {
  list,
  create,
  get,
  update,
  syncTools,
  delete: remove,
} as const;
