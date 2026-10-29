import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateOAuthAppBodySchema,
  CreateOAuthAppFromServerBodySchema,
  PublicOAuthAppSchema,
  UpdateOAuthAppBodySchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const OAuthAppIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("OAuthAppIdParam");

const DeleteOAuthAppQuerySchema = z.object({
  detach: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "detach", in: "query" },
      description:
        "When true, unlink servers that use this app (they fall back to their own OAuth fields) instead of refusing.",
    }),
});

const OAuthAppResponseSchema = successEnvelopeSchema(
  PublicOAuthAppSchema,
  "OAuthAppResponse",
);

const OAuthAppListResponseSchema = successEnvelopeSchema(
  z.object({ items: z.array(PublicOAuthAppSchema) }),
  "OAuthAppListResponse",
);

const appNotFound = notFoundError("OAuth app not found");

const list = createRoute({
  method: "get",
  path: "/oauth-apps",
  tags: ["OAuth apps"],
  summary: "List shared OAuth apps for the active tenant (secrets are never returned)",
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "OAuth apps sorted by name",
      content: { "application/json": { schema: OAuthAppListResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/oauth-apps",
  tags: ["OAuth apps"],
  summary: "Create a shared OAuth app (client secret is write-only)",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: {
        "application/json": {
          schema: CreateOAuthAppBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "OAuth app created",
      content: { "application/json": { schema: OAuthAppResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const createFromServer = createRoute({
  method: "post",
  path: "/oauth-apps/from-server",
  tags: ["OAuth apps"],
  summary:
    "Save a server's own OAuth client id + secret as a shared app and link the server to it",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: {
        "application/json": {
          schema: CreateOAuthAppFromServerBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "OAuth app created and linked to the server",
      content: { "application/json": { schema: OAuthAppResponseSchema } },
    },
    ...tenantScopedErrors,
    ...notFoundError("Server not found"),
  },
});

const get = createRoute({
  method: "get",
  path: "/oauth-apps/{id}",
  tags: ["OAuth apps"],
  summary: "Get a shared OAuth app by id",
  request: { headers: TenantIdHeaderSchema, params: OAuthAppIdParamSchema },
  responses: {
    200: {
      description: "OAuth app",
      content: { "application/json": { schema: OAuthAppResponseSchema } },
    },
    ...tenantScopedErrors,
    ...appNotFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/oauth-apps/{id}",
  tags: ["OAuth apps"],
  summary:
    "Update a shared OAuth app; pass clientSecret to rotate it for every linked server",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: OAuthAppIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateOAuthAppBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "OAuth app updated",
      content: { "application/json": { schema: OAuthAppResponseSchema } },
    },
    ...tenantScopedErrors,
    ...appNotFound,
  },
});

const remove = createRoute({
  method: "delete",
  path: "/oauth-apps/{id}",
  tags: ["OAuth apps"],
  summary:
    "Delete a shared OAuth app (refused while servers use it unless detach=true)",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: OAuthAppIdParamSchema,
    query: DeleteOAuthAppQuerySchema,
  },
  responses: {
    200: {
      description: "OAuth app deleted",
      content: { "application/json": { schema: OAuthAppResponseSchema } },
    },
    ...tenantScopedErrors,
    ...appNotFound,
  },
});

export const oauthAppRoutes = {
  list,
  create,
  createFromServer,
  get,
  update,
  delete: remove,
} as const;
