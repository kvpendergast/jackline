import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateMcpOauthClientBodySchema,
  MintedMcpOauthClientSchema,
  PublicMcpOauthClientSchema,
  UpdateMcpOauthClientRedirectsBodySchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { requireAdmin } from "../../lib/request/requireAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const ConnectionIdParamSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
  })
  .openapi("McpOauthConnectionIdParam");

const ClientParamsSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
    clientId: z.uuid().openapi({ param: { name: "clientId", in: "path" } }),
  })
  .openapi("McpOauthClientParams");

const createClient = createRoute({
  method: "post",
  path: "/connections/{id}/mcp-oauth/clients",
  tags: ["MCP OAuth"],
  summary: "Create an MCP OAuth client for a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
    body: {
      content: {
        "application/json": { schema: CreateMcpOauthClientBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            MintedMcpOauthClientSchema,
            "MintedMcpOauthClientResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
  },
});

const listClients = createRoute({
  method: "get",
  path: "/connections/{id}/mcp-oauth/clients",
  tags: ["MCP OAuth"],
  summary: "List MCP OAuth clients for a connection",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            z.array(PublicMcpOauthClientSchema),
            "McpOauthClientListResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
  },
});

const getClient = createRoute({
  method: "get",
  path: "/connections/{id}/mcp-oauth/clients/{clientId}",
  tags: ["MCP OAuth"],
  summary: "Get an MCP OAuth client",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientParamsSchema,
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            PublicMcpOauthClientSchema,
            "McpOauthClientResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Not found"),
  },
});

const updateRedirects = createRoute({
  method: "patch",
  path: "/connections/{id}/mcp-oauth/clients/{clientId}/redirects",
  tags: ["MCP OAuth"],
  summary: "Replace redirect URI allowlist (presets + custom)",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateMcpOauthClientRedirectsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            PublicMcpOauthClientSchema,
            "McpOauthClientResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Not found"),
  },
});

const rotateSecret = createRoute({
  method: "post",
  path: "/connections/{id}/mcp-oauth/clients/{clientId}/rotate-secret",
  tags: ["MCP OAuth"],
  summary: "Rotate MCP OAuth client secret and kill sessions",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientParamsSchema,
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            MintedMcpOauthClientSchema,
            "MintedMcpOauthClientResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Not found"),
  },
});

const revokeClient = createRoute({
  method: "post",
  path: "/connections/{id}/mcp-oauth/clients/{clientId}/revoke",
  tags: ["MCP OAuth"],
  summary: "Revoke an MCP OAuth client and kill sessions",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientParamsSchema,
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            PublicMcpOauthClientSchema,
            "McpOauthClientResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Not found"),
  },
});

const revokeSessions = createRoute({
  method: "post",
  path: "/connections/{id}/mcp-oauth/clients/{clientId}/revoke-sessions",
  tags: ["MCP OAuth"],
  summary: "Kill all refresh/access sessions for an MCP OAuth client",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientParamsSchema,
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            z.strictObject({
              revokedRefreshTokens: z.number().int().nonnegative(),
              revokedAccessTokens: z.number().int().nonnegative(),
            }),
            "McpOauthRevokeSessionsResponse",
          ),
        },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Not found"),
  },
});

export const mcpOauthRoutes = {
  createClient,
  listClients,
  getClient,
  updateRedirects,
  rotateSecret,
  revokeClient,
  revokeSessions,
};
