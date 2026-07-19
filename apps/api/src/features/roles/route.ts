import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicRoleDetailSchema,
  PublicRoleSchema,
  RoleTypeSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const RoleIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("RoleIdParam");

const RoleToolParamsSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
    }),
    toolId: z.uuid().openapi({
      param: { name: "toolId", in: "path" },
    }),
  })
  .openapi("RoleToolParams");

const CreateRoleBodySchema = z
  .strictObject({
    name: z.string().min(1),
    type: RoleTypeSchema,
    description: z.string().min(1).nullable().optional(),
  })
  .openapi("CreateRoleBody");

const UpdateRoleBodySchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    type: RoleTypeSchema.optional(),
    description: z.string().min(1).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .openapi("UpdateRoleBody");

const AttachRoleToolBodySchema = z
  .strictObject({
    toolId: z.uuid(),
  })
  .openapi("AttachRoleToolBody");

const SetRoleToolsBodySchema = z
  .strictObject({
    toolIds: z.array(z.uuid()),
  })
  .openapi("SetRoleToolsBody");

const RoleResponseSchema = successEnvelopeSchema(
  PublicRoleSchema,
  "RoleResponse",
);

const RoleDetailResponseSchema = successEnvelopeSchema(
  PublicRoleDetailSchema,
  "RoleDetailResponse",
);

const RoleListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicRoleSchema),
  "RoleListResponse",
);

const roleNotFound = notFoundError("Role not found");

const list = createRoute({
  method: "get",
  path: "/roles",
  tags: ["Roles"],
  summary: "List roles for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of roles (newest first)",
      content: {
        "application/json": { schema: RoleListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/roles",
  tags: ["Roles"],
  summary: "Create a role",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateRoleBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Role created",
      content: {
        "application/json": { schema: RoleDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Get a role by id (includes toolIds)",
  request: {
    headers: TenantIdHeaderSchema,
    params: RoleIdParamSchema,
  },
  responses: {
    200: {
      description: "Role detail",
      content: {
        "application/json": { schema: RoleDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...roleNotFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Update a role",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: RoleIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateRoleBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Role updated",
      content: {
        "application/json": { schema: RoleDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...roleNotFound,
  },
});

const remove = createRoute({
  method: "delete",
  path: "/roles/{id}",
  tags: ["Roles"],
  summary: "Delete a role",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: RoleIdParamSchema,
  },
  responses: {
    200: {
      description: "Role deleted",
      content: {
        "application/json": { schema: RoleResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...roleNotFound,
  },
});

const attachTool = createRoute({
  method: "post",
  path: "/roles/{id}/tools",
  tags: ["Roles"],
  summary: "Attach a tool to a role",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: RoleIdParamSchema,
    body: {
      content: { "application/json": { schema: AttachRoleToolBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Role with updated toolIds",
      content: {
        "application/json": { schema: RoleDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...roleNotFound,
  },
});

const setTools = createRoute({
  method: "put",
  path: "/roles/{id}/tools",
  tags: ["Roles"],
  summary: "Replace the tools attached to a role",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: RoleIdParamSchema,
    body: {
      content: { "application/json": { schema: SetRoleToolsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Role with replaced toolIds",
      content: {
        "application/json": { schema: RoleDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...roleNotFound,
  },
});

const detachTool = createRoute({
  method: "delete",
  path: "/roles/{id}/tools/{toolId}",
  tags: ["Roles"],
  summary: "Detach a tool from a role",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: RoleToolParamsSchema,
  },
  responses: {
    200: {
      description: "Role with updated toolIds",
      content: {
        "application/json": { schema: RoleDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Role tool binding not found"),
  },
});

export const roleRoutes = {
  list,
  create,
  get,
  update,
  delete: remove,
  attachTool,
  setTools,
  detachTool,
} as const;
