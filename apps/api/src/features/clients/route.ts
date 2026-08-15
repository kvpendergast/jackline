import { createRoute, z } from "@hono/zod-openapi";
import {
  ClientKindSchema,
  cursorPageSchema,
  MembershipRoleSchema,
  MintedClientCredentialsSchema,
  PublicClientSchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const ClientIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("ClientIdParam");

const ListClientsQuerySchema = PaginationQuerySchema.extend({
  kind: ClientKindSchema.optional().openapi({
    param: { name: "kind", in: "query" },
    description: "Filter by client kind",
  }),
}).openapi("ListClientsQuery");

const CreateClientBodySchema = z
  .strictObject({
    name: z.string().min(1),
    kind: ClientKindSchema,
    ownerUserId: z.string().min(1).nullable().optional(),
  })
  .openapi("CreateClientBody");

const UpdateClientBodySchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    kind: ClientKindSchema.optional(),
    apiRole: MembershipRoleSchema.optional(),
    apiTeam: z.string().min(1).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  })
  .openapi("UpdateClientBody");

const ClientResponseSchema = successEnvelopeSchema(
  PublicClientSchema,
  "ClientResponse",
);

const ClientListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicClientSchema),
  "ClientListResponse",
);

const MintedCredentialsResponseSchema = successEnvelopeSchema(
  MintedClientCredentialsSchema,
  "MintedClientCredentialsResponse",
);

const RotateCredentialsBodySchema = z
  .strictObject({
    apiRole: MembershipRoleSchema.optional(),
    apiTeam: z.string().min(1).nullable().optional(),
  })
  .openapi("RotateClientCredentialsBody");

const clientNotFound = notFoundError("Client not found");

const list = createRoute({
  method: "get",
  path: "/clients",
  tags: ["Clients"],
  summary: "List clients for the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: ListClientsQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of clients (newest first)",
      content: {
        "application/json": { schema: ClientListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/clients",
  tags: ["Clients"],
  summary: "Create a client (members: own interactive; admins: any)",
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateClientBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Client created",
      content: {
        "application/json": { schema: ClientResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/clients/{id}",
  tags: ["Clients"],
  summary: "Get a client by id",
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientIdParamSchema,
  },
  responses: {
    200: {
      description: "Client",
      content: {
        "application/json": { schema: ClientResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...clientNotFound,
  },
});

const update = createRoute({
  method: "patch",
  path: "/clients/{id}",
  tags: ["Clients"],
  summary: "Update a client you manage",
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientIdParamSchema,
    body: {
      content: { "application/json": { schema: UpdateClientBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Client updated",
      content: {
        "application/json": { schema: ClientResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...clientNotFound,
  },
});

const remove = createRoute({
  method: "delete",
  path: "/clients/{id}",
  tags: ["Clients"],
  summary: "Delete a client you manage",
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientIdParamSchema,
  },
  responses: {
    200: {
      description: "Client deleted",
      content: {
        "application/json": { schema: ClientResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...clientNotFound,
  },
});

const rotateCredentials = createRoute({
  method: "post",
  path: "/clients/{id}/credentials",
  tags: ["Clients"],
  summary: "Mint or rotate OAuth2 client credentials",
  description:
    "Only service clients can hold client_credentials. The client_secret is shown once. Existing access tokens for this client are revoked.",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientIdParamSchema,
    body: {
      content: { "application/json": { schema: RotateCredentialsBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Credentials minted; store client_secret now — it is not shown again",
      content: {
        "application/json": { schema: MintedCredentialsResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...clientNotFound,
  },
});

const revokeCredentials = createRoute({
  method: "delete",
  path: "/clients/{id}/credentials",
  tags: ["Clients"],
  summary: "Revoke OAuth2 client credentials",
  description:
    "Clears the client_secret and revokes outstanding access tokens for this client.",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    params: ClientIdParamSchema,
  },
  responses: {
    200: {
      description: "Credentials revoked",
      content: {
        "application/json": { schema: ClientResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...clientNotFound,
  },
});

export const clientRoutes = {
  list,
  create,
  get,
  update,
  delete: remove,
  rotateCredentials,
  revokeCredentials,
} as const;
