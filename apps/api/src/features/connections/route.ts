import { createRoute, z } from "@hono/zod-openapi";
import {
  ConnectionStatusSchema,
  ConnectionToolOverrideTypeSchema,
  cursorPageSchema,
  MintedGatewayCredentialSchema,
  PublicConnectionDetailSchema,
  PublicConnectionSchema,
  PublicEffectiveToolSchema,
  PublicGatewayCredentialSchema,
  UpstreamCredentialStatusSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireAdmin } from "../../lib/request/requireAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const ConnectionIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
    }),
  })
  .openapi("ConnectionIdParam");

const ConnectionRoleParamsSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
    roleId: z.uuid().openapi({ param: { name: "roleId", in: "path" } }),
  })
  .openapi("ConnectionRoleParams");

const ConnectionToolOverrideParamsSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
    toolId: z.uuid().openapi({ param: { name: "toolId", in: "path" } }),
  })
  .openapi("ConnectionToolOverrideParams");

const ConnectionCredentialParamsSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
    secretId: z.uuid().openapi({ param: { name: "secretId", in: "path" } }),
  })
  .openapi("ConnectionCredentialParams");

const MintCredentialBodySchema = z
  .strictObject({
    name: z.string().min(1).optional(),
  })
  .openapi("MintCredentialBody");

const ListConnectionsQuerySchema = PaginationQuerySchema.extend({
  clientId: z.uuid().optional().openapi({
    param: { name: "clientId", in: "query" },
  }),
  userId: z.string().min(1).optional().openapi({
    param: { name: "userId", in: "query" },
  }),
  status: ConnectionStatusSchema.optional().openapi({
    param: { name: "status", in: "query" },
  }),
}).openapi("ListConnectionsQuery");

const CreateConnectionBodySchema = z
  .strictObject({
    clientId: z.uuid(),
    userId: z.string().min(1),
    status: ConnectionStatusSchema.optional(),
  })
  .openapi("CreateConnectionBody");

const UpdateConnectionBodySchema = z
  .strictObject({
    status: ConnectionStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .openapi("UpdateConnectionBody");

const AttachConnectionRoleBodySchema = z
  .strictObject({ roleId: z.uuid() })
  .openapi("AttachConnectionRoleBody");

const SetConnectionRolesBodySchema = z
  .strictObject({ roleIds: z.array(z.uuid()) })
  .openapi("SetConnectionRolesBody");

const AttachToolOverrideBodySchema = z
  .strictObject({
    toolId: z.uuid(),
    type: ConnectionToolOverrideTypeSchema,
  })
  .openapi("AttachToolOverrideBody");

const SetToolOverridesBodySchema = z
  .strictObject({
    overrides: z.array(
      z.strictObject({
        toolId: z.uuid(),
        type: ConnectionToolOverrideTypeSchema,
      }),
    ),
  })
  .openapi("SetToolOverridesBody");

const ConnectionResponseSchema = successEnvelopeSchema(
  PublicConnectionSchema,
  "ConnectionResponse",
);

const ConnectionDetailResponseSchema = successEnvelopeSchema(
  PublicConnectionDetailSchema,
  "ConnectionDetailResponse",
);

const ConnectionListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicConnectionSchema),
  "ConnectionListResponse",
);

const connectionNotFound = notFoundError("Connection not found");

const EffectiveToolsResponseSchema = successEnvelopeSchema(
  z.object({ items: z.array(PublicEffectiveToolSchema) }),
  "EffectiveToolsResponse",
);

const UpstreamCredentialsResponseSchema = successEnvelopeSchema(
  z.object({ items: z.array(UpstreamCredentialStatusSchema) }),
  "UpstreamCredentialsResponse",
);

const listEffectiveTools = createRoute({
  method: "get",
  path: "/connections/{id}/effective-tools",
  tags: ["Connections"],
  summary: "List effective tools for a connection (roles + overrides, deny wins)",
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: "Resolved tools with source attribution",
      content: {
        "application/json": { schema: EffectiveToolsResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const listUpstreamCredentials = createRoute({
  method: "get",
  path: "/connections/{id}/upstream-credentials",
  tags: ["Connections"],
  summary:
    "List upstream credential readiness for the connection subject across active servers",
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: "Per-server upstream credential status for the subject",
      content: {
        "application/json": { schema: UpstreamCredentialsResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const list = createRoute({
  method: "get",
  path: "/connections",
  tags: ["Connections"],
  summary: "List connections for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: ListConnectionsQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of connections (newest first)",
      content: {
        "application/json": { schema: ConnectionListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/connections",
  tags: ["Connections"],
  summary: "Create a connection (client + user)",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateConnectionBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Connection created",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/connections/{id}",
  tags: ["Connections"],
  summary: "Get a connection (includes roleIds and toolOverrides)",
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: "Connection detail",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/connections/{id}",
  tags: ["Connections"],
  summary: "Update connection status",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateConnectionBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Connection updated",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const remove = createRoute({
  method: "delete",
  path: "/connections/{id}",
  tags: ["Connections"],
  summary: "Delete a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: "Connection deleted",
      content: {
        "application/json": { schema: ConnectionResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const attachRole = createRoute({
  method: "post",
  path: "/connections/{id}/roles",
  tags: ["Connections"],
  summary: "Attach a role to a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: {
        "application/json": { schema: AttachConnectionRoleBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Connection with updated roleIds",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const setRoles = createRoute({
  method: "put",
  path: "/connections/{id}/roles",
  tags: ["Connections"],
  summary: "Replace roles on a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: { "application/json": { schema: SetConnectionRolesBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Connection with replaced roleIds",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const detachRole = createRoute({
  method: "delete",
  path: "/connections/{id}/roles/{roleId}",
  tags: ["Connections"],
  summary: "Detach a role from a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionRoleParamsSchema,
  },
  responses: {
    200: {
      description: "Connection with updated roleIds",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Connection role binding not found"),
  },
});

const attachToolOverride = createRoute({
  method: "post",
  path: "/connections/{id}/tool-overrides",
  tags: ["Connections"],
  summary: "Attach a tool override to a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: { "application/json": { schema: AttachToolOverrideBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Connection with updated toolOverrides",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const setToolOverrides = createRoute({
  method: "put",
  path: "/connections/{id}/tool-overrides",
  tags: ["Connections"],
  summary: "Replace tool overrides on a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: { "application/json": { schema: SetToolOverridesBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Connection with replaced toolOverrides",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const detachToolOverride = createRoute({
  method: "delete",
  path: "/connections/{id}/tool-overrides/{toolId}",
  tags: ["Connections"],
  summary: "Detach a tool override from a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionToolOverrideParamsSchema,
  },
  responses: {
    200: {
      description: "Connection with updated toolOverrides",
      content: {
        "application/json": { schema: ConnectionDetailResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Connection tool override not found"),
  },
});

const MintedCredentialResponseSchema = successEnvelopeSchema(
  MintedGatewayCredentialSchema,
  "MintedGatewayCredentialResponse",
);

const GatewayCredentialListResponseSchema = successEnvelopeSchema(
  z.array(PublicGatewayCredentialSchema),
  "GatewayCredentialListResponse",
);

const GatewayCredentialResponseSchema = successEnvelopeSchema(
  PublicGatewayCredentialSchema,
  "GatewayCredentialResponse",
);

const mintCredential = createRoute({
  method: "post",
  path: "/connections/{id}/credentials",
  tags: ["Connections"],
  summary: "Mint a gateway bearer token for a connection (plaintext returned once)",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: { "application/json": { schema: MintCredentialBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Credential minted; store token now — it is not shown again",
      content: {
        "application/json": { schema: MintedCredentialResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const listCredentials = createRoute({
  method: "get",
  path: "/connections/{id}/credentials",
  tags: ["Connections"],
  summary: "List gateway credentials for a connection (metadata only)",
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: "Gateway credentials (no plaintext)",
      content: {
        "application/json": { schema: GatewayCredentialListResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...connectionNotFound,
  },
});

const revokeCredential = createRoute({
  method: "delete",
  path: "/connections/{id}/credentials/{secretId}",
  tags: ["Connections"],
  summary: "Revoke a gateway credential",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionCredentialParamsSchema,
  },
  responses: {
    200: {
      description: "Credential revoked",
      content: {
        "application/json": { schema: GatewayCredentialResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Gateway credential not found"),
  },
});

export const connectionRoutes = {
  list,
  create,
  get,
  listEffectiveTools,
  listUpstreamCredentials,
  update,
  delete: remove,
  attachRole,
  setRoles,
  detachRole,
  attachToolOverride,
  setToolOverrides,
  detachToolOverride,
  mintCredential,
  listCredentials,
  revokeCredential,
} as const;
