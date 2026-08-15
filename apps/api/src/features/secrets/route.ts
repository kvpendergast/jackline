import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicSecretSchema,
  SecretValueSchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const SecretIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
    }),
  })
  .openapi("SecretIdParam");

const ListSecretsQuerySchema = PaginationQuerySchema.extend({
  kind: z.string().min(1).optional().openapi({
    param: { name: "kind", in: "query" },
  }),
  serverId: z.uuid().optional().openapi({
    param: { name: "serverId", in: "query" },
  }),
  userId: z.string().min(1).optional().openapi({
    param: { name: "userId", in: "query" },
  }),
  connectionId: z.uuid().optional().openapi({
    param: { name: "connectionId", in: "query" },
  }),
}).openapi("ListSecretsQuery");

const CreateSecretBodySchema = z
  .strictObject({
    kind: z.string().min(1),
    name: z.string().min(1),
    value: z.string().min(1),
    meta: z.record(z.string(), z.unknown()).optional(),
    serverId: z.uuid().nullable().optional(),
    userId: z.string().min(1).nullable().optional(),
    connectionId: z.uuid().nullable().optional(),
  })
  .openapi("CreateSecretBody");

const UpdateSecretBodySchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    value: z.string().min(1).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .openapi("UpdateSecretBody");

const SecretResponseSchema = successEnvelopeSchema(
  PublicSecretSchema,
  "SecretResponse",
);

const SecretListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicSecretSchema),
  "SecretListResponse",
);

const SecretValueResponseSchema = successEnvelopeSchema(
  SecretValueSchema,
  "SecretValueResponse",
);

const secretNotFound = notFoundError("Secret not found");

const list = createRoute({
  method: "get",
  path: "/secrets",
  tags: ["Secrets"],
  summary: "List secret metadata for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: ListSecretsQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of secrets (metadata only)",
      content: {
        "application/json": { schema: SecretListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/secrets",
  tags: ["Secrets"],
  summary: "Create and encrypt a secret",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateSecretBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Secret created (metadata only)",
      content: {
        "application/json": { schema: SecretResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/secrets/{id}",
  tags: ["Secrets"],
  summary: "Get secret metadata by id",
  request: {
    headers: TenantIdHeaderSchema,
    params: SecretIdParamSchema,
  },
  responses: {
    200: {
      description: "Secret metadata",
      content: {
        "application/json": { schema: SecretResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...secretNotFound,
  },
});

const reveal = createRoute({
  method: "get",
  path: "/secrets/{id}/value",
  tags: ["Secrets"],
  summary: "Decrypt and return a secret value",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: SecretIdParamSchema,
  },
  responses: {
    200: {
      description: "Decrypted secret value",
      content: {
        "application/json": { schema: SecretValueResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...secretNotFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/secrets/{id}",
  tags: ["Secrets"],
  summary: "Update secret metadata and/or rotate value",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: SecretIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateSecretBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Secret updated (metadata only)",
      content: {
        "application/json": { schema: SecretResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...secretNotFound,
  },
});

const remove = createRoute({
  method: "delete",
  path: "/secrets/{id}",
  tags: ["Secrets"],
  summary: "Delete a secret",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: SecretIdParamSchema,
  },
  responses: {
    200: {
      description: "Secret deleted (metadata only)",
      content: {
        "application/json": { schema: SecretResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...secretNotFound,
  },
});

export const secretRoutes = {
  list,
  create,
  get,
  reveal,
  update,
  delete: remove,
} as const;
