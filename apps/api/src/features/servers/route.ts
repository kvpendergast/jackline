import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicServerSchema,
  ServerAuthMethodSchema,
  ServerKindSchema,
  ServerSourceSchema,
  ServerStatusSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
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

export const listServersRoute = createRoute({
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

export const createServerRoute = createRoute({
  method: "post",
  path: "/servers",
  tags: ["Servers"],
  summary: "Create a server",
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

export const getServerRoute = createRoute({
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

export const updateServerRoute = createRoute({
  method: "patch",
  path: "/servers/{id}",
  tags: ["Servers"],
  summary: "Update a server",
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

export const deleteServerRoute = createRoute({
  method: "delete",
  path: "/servers/{id}",
  tags: ["Servers"],
  summary: "Delete a server",
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
