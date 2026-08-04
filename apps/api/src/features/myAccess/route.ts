import { createRoute, z } from "@hono/zod-openapi";
import {
  MyAccessServerSchema,
  PublicSecretSchema,
  UpsertMyAccessCredentialBodySchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const ServerIdParamSchema = z
  .object({
    serverId: z.uuid().openapi({
      param: { name: "serverId", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("MyAccessServerIdParam");

const MyAccessServerListResponseSchema = successEnvelopeSchema(
  z.object({ items: z.array(MyAccessServerSchema) }),
  "MyAccessServerListResponse",
);

const MyAccessCredentialResponseSchema = successEnvelopeSchema(
  PublicSecretSchema,
  "MyAccessCredentialResponse",
);

const DeleteMyAccessCredentialResponseSchema = successEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
  "DeleteMyAccessCredentialResponse",
);

const serverNotFound = notFoundError("Server not found");
const credentialNotFound = notFoundError("Credential not found");

const listMyServers = createRoute({
  method: "get",
  path: "/me/servers",
  tags: ["My Access"],
  summary: "List active servers and this user’s personal credential status",
  request: {
    headers: TenantIdHeaderSchema,
  },
  responses: {
    200: {
      description: "Servers with personal credential status",
      content: {
        "application/json": { schema: MyAccessServerListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const upsertMyCredential = createRoute({
  method: "put",
  path: "/me/servers/{serverId}/credential",
  tags: ["My Access"],
  summary: "Create or replace this user’s personal credential for a server",
  request: {
    headers: TenantIdHeaderSchema,
    params: ServerIdParamSchema,
    body: {
      content: {
        "application/json": { schema: UpsertMyAccessCredentialBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Credential metadata (value never returned)",
      content: {
        "application/json": { schema: MyAccessCredentialResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...serverNotFound,
  },
});

const deleteMyCredential = createRoute({
  method: "delete",
  path: "/me/servers/{serverId}/credential",
  tags: ["My Access"],
  summary: "Remove this user’s personal credential for a server",
  request: {
    headers: TenantIdHeaderSchema,
    params: ServerIdParamSchema,
  },
  responses: {
    200: {
      description: "Credential deleted",
      content: {
        "application/json": {
          schema: DeleteMyAccessCredentialResponseSchema,
        },
      },
    },
    ...tenantScopedErrors,
    ...serverNotFound,
    ...credentialNotFound,
  },
});

export const myAccessRoutes = {
  listMyServers,
  upsertMyCredential,
  deleteMyCredential,
} as const;
