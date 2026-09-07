import { createRoute, z } from "@hono/zod-openapi";
import {
  AgentDirectoryResponseSchema,
  ApproveKnockBodySchema,
  CreateAgentBodySchema,
  DenyKnockBodySchema,
  ExchangeTrustGrantBodySchema,
  MintedPeerGrantCredentialSchema,
  PublicAgentSchema,
  PublicKnockSchema,
  PublicTrustGrantSchema,
  UpdateAgentBodySchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const AgentIdParamSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
  })
  .openapi("AgentIdParam");

const KnockIdParamSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
  })
  .openapi("KnockIdParam");

const GrantIdParamSchema = z
  .object({
    id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
  })
  .openapi("GrantIdParam");

const SetAgentToolsBodyOpenApiSchema = z
  .strictObject({
    toolIds: z.array(z.uuid()),
  })
  .openapi("SetAgentToolsBody");

const AgentListResponseSchema = successEnvelopeSchema(
  z.strictObject({ items: z.array(PublicAgentSchema) }),
  "AgentListResponse",
);

const AgentResponseSchema = successEnvelopeSchema(
  PublicAgentSchema,
  "AgentResponse",
);

const KnockListResponseSchema = successEnvelopeSchema(
  z.strictObject({ items: z.array(PublicKnockSchema) }),
  "KnockListResponse",
);

const TrustGrantListResponseSchema = successEnvelopeSchema(
  z.strictObject({ items: z.array(PublicTrustGrantSchema) }),
  "TrustGrantListResponse",
);

const DirectoryResponseSchema = successEnvelopeSchema(
  AgentDirectoryResponseSchema,
  "AgentDirectoryResponse",
);

const ExchangeResponseSchema = successEnvelopeSchema(
  MintedPeerGrantCredentialSchema,
  "ExchangeTrustGrantResponse",
);

export const agentRoutes = {
  list: createRoute({
    method: "get",
    path: "/agents",
    tags: ["Agents"],
    summary: "List my agents",
    request: { headers: TenantIdHeaderSchema },
    responses: {
      200: {
        content: { "application/json": { schema: AgentListResponseSchema } },
        description: "Agent list",
      },
      ...tenantScopedErrors,
    },
  }),

  create: createRoute({
    method: "post",
    path: "/agents",
    tags: ["Agents"],
    summary: "Create an agent",
    request: {
      headers: TenantIdHeaderSchema,
      body: {
        content: { "application/json": { schema: CreateAgentBodySchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: AgentResponseSchema } },
        description: "Created agent",
      },
      ...tenantScopedErrors,
    },
  }),

  get: createRoute({
    method: "get",
    path: "/agents/{id}",
    tags: ["Agents"],
    summary: "Get an agent",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
    },
    responses: {
      200: {
        content: { "application/json": { schema: AgentResponseSchema } },
        description: "Agent",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  update: createRoute({
    method: "patch",
    path: "/agents/{id}",
    tags: ["Agents"],
    summary: "Update an agent",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
      body: {
        content: { "application/json": { schema: UpdateAgentBodySchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: AgentResponseSchema } },
        description: "Updated agent",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  setTools: createRoute({
    method: "put",
    path: "/agents/{id}/tools",
    tags: ["Agents"],
    summary: "Replace the MCP tools bound to an agent",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
      body: {
        content: {
          "application/json": {
            schema: SetAgentToolsBodyOpenApiSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: AgentResponseSchema } },
        description: "Agent with replaced toolIds",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  publish: createRoute({
    method: "post",
    path: "/agents/{id}/publish",
    tags: ["Agents"],
    summary: "Publish agent to public network directory",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
    },
    responses: {
      200: {
        content: { "application/json": { schema: AgentResponseSchema } },
        description: "Published agent",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  pause: createRoute({
    method: "post",
    path: "/agents/{id}/pause",
    tags: ["Agents"],
    summary: "Pause agent (remove from directory)",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
    },
    responses: {
      200: {
        content: { "application/json": { schema: AgentResponseSchema } },
        description: "Paused agent",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  listKnocks: createRoute({
    method: "get",
    path: "/agents/{id}/knocks",
    tags: ["Agents"],
    summary: "List knocks for an agent",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
    },
    responses: {
      200: {
        content: { "application/json": { schema: KnockListResponseSchema } },
        description: "Knock list",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  approveKnock: createRoute({
    method: "post",
    path: "/knocks/{id}/approve",
    tags: ["Agents"],
    summary: "Approve a knock and create a trust grant",
    request: {
      headers: TenantIdHeaderSchema,
      params: KnockIdParamSchema,
      body: {
        content: { "application/json": { schema: ApproveKnockBodySchema } },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: successEnvelopeSchema(
              PublicTrustGrantSchema,
              "ApproveKnockResponse",
            ),
          },
        },
        description: "Trust grant created",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  denyKnock: createRoute({
    method: "post",
    path: "/knocks/{id}/deny",
    tags: ["Agents"],
    summary: "Deny a knock",
    request: {
      headers: TenantIdHeaderSchema,
      params: KnockIdParamSchema,
      body: {
        content: { "application/json": { schema: DenyKnockBodySchema } },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: successEnvelopeSchema(PublicKnockSchema, "DenyKnockResponse"),
          },
        },
        description: "Knock denied",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  listTrustGrants: createRoute({
    method: "get",
    path: "/agents/{id}/trust-grants",
    tags: ["Agents"],
    summary: "List trust grants for an agent",
    request: {
      headers: TenantIdHeaderSchema,
      params: AgentIdParamSchema,
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: TrustGrantListResponseSchema },
        },
        description: "Trust grants",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  revokeTrustGrant: createRoute({
    method: "post",
    path: "/trust-grants/{id}/revoke",
    tags: ["Agents"],
    summary: "Revoke a trust grant",
    request: {
      headers: TenantIdHeaderSchema,
      params: GrantIdParamSchema,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: successEnvelopeSchema(
              PublicTrustGrantSchema,
              "RevokeTrustGrantResponse",
            ),
          },
        },
        description: "Revoked grant",
      },
      ...notFoundError,
      ...tenantScopedErrors,
    },
  }),

  directory: createRoute({
    method: "get",
    path: "/networks/public/directory",
    tags: ["AgentDirectory"],
    summary: "Search public agent directory",
    request: {
      headers: TenantIdHeaderSchema,
      query: z.object({
        q: z.string().optional(),
        handle: z.string().optional(),
        skill: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: DirectoryResponseSchema } },
        description: "Directory results",
      },
      ...tenantScopedErrors,
    },
  }),

  agentRegistry: createRoute({
    method: "get",
    path: "/agent-registry",
    tags: ["AgentDirectory"],
    summary: "Alias for public agent directory search",
    request: {
      headers: TenantIdHeaderSchema,
      query: z.object({
        q: z.string().optional(),
        handle: z.string().optional(),
        skill: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: DirectoryResponseSchema } },
        description: "Directory results",
      },
      ...tenantScopedErrors,
    },
  }),

  exchangeTrustGrant: createRoute({
    method: "post",
    path: "/trust/exchange",
    tags: ["AgentDirectory"],
    summary: "Exchange knock credentials for a jka_ peer grant token",
    request: {
      headers: TenantIdHeaderSchema,
      body: {
        content: {
          "application/json": { schema: ExchangeTrustGrantBodySchema },
        },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ExchangeResponseSchema } },
        description: "Minted peer credential",
      },
      ...tenantScopedErrors,
    },
  }),
} as const;
