import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicToolSchema,
  ToolStatusSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const ToolIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("ToolIdParam");

const ListToolsQuerySchema = PaginationQuerySchema.extend({
  serverId: z
    .uuid()
    .optional()
    .openapi({
      param: { name: "serverId", in: "query" },
      description: "Filter tools belonging to a server",
    }),
}).openapi("ListToolsQuery");

const CreateToolBodySchema = z
  .strictObject({
    name: z.string().min(1),
    serverId: z.uuid(),
    status: ToolStatusSchema.optional(),
  })
  .openapi("CreateToolBody");

const UpdateToolBodySchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    status: ToolStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .openapi("UpdateToolBody");

const ToolResponseSchema = successEnvelopeSchema(
  PublicToolSchema,
  "ToolResponse",
);

const ToolListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicToolSchema),
  "ToolListResponse",
);

const toolNotFound = notFoundError("Tool not found");

export const listToolsRoute = createRoute({
  method: "get",
  path: "/tools",
  tags: ["Tools"],
  summary: "List tools for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: ListToolsQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of tools (newest first)",
      content: {
        "application/json": { schema: ToolListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

export const createToolRoute = createRoute({
  method: "post",
  path: "/tools",
  tags: ["Tools"],
  summary: "Create a tool on a server",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateToolBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Tool created",
      content: {
        "application/json": { schema: ToolResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

export const getToolRoute = createRoute({
  method: "get",
  path: "/tools/{id}",
  tags: ["Tools"],
  summary: "Get a tool by id",
  request: {
    headers: TenantIdHeaderSchema,
    params: ToolIdParamSchema,
  },
  responses: {
    200: {
      description: "Tool",
      content: {
        "application/json": { schema: ToolResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...toolNotFound,
  },
});

export const updateToolRoute = createRoute({
  method: "patch",
  path: "/tools/{id}",
  tags: ["Tools"],
  summary: "Update a tool",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ToolIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateToolBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Tool updated",
      content: {
        "application/json": { schema: ToolResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...toolNotFound,
  },
});

export const deleteToolRoute = createRoute({
  method: "delete",
  path: "/tools/{id}",
  tags: ["Tools"],
  summary: "Delete a tool",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ToolIdParamSchema,
  },
  responses: {
    200: {
      description: "Tool deleted",
      content: {
        "application/json": { schema: ToolResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...toolNotFound,
  },
});
