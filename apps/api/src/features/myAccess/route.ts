import { createRoute, z } from "@hono/zod-openapi";
import {
  MyAccessAccountSchema,
  MyAccessServerSchema,
  PublicSecretSchema,
  RenameUpstreamAccountBodySchema,
  UpsertMyAccessCredentialBodySchema,
} from "@jackline/shared";
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

const AccountIdParamSchema = z
  .object({
    accountId: z.uuid().openapi({
      param: { name: "accountId", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("MyAccessAccountIdParam");

const MyAccessAccountResponseSchema = successEnvelopeSchema(
  MyAccessAccountSchema,
  "MyAccessAccountResponse",
);

const serverNotFound = notFoundError("Server not found");
const credentialNotFound = notFoundError("Credential not found");
const accountNotFound = notFoundError("Account not found");

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

const renameAccount = createRoute({
  method: "patch",
  path: "/me/accounts/{accountId}",
  tags: ["My Access"],
  summary: "Rename one of this user’s upstream accounts",
  request: {
    headers: TenantIdHeaderSchema,
    params: AccountIdParamSchema,
    body: {
      content: {
        "application/json": { schema: RenameUpstreamAccountBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated account",
      content: {
        "application/json": { schema: MyAccessAccountResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...accountNotFound,
  },
});

const makeDefaultAccount = createRoute({
  method: "post",
  path: "/me/accounts/{accountId}/default",
  tags: ["My Access"],
  summary: "Mark one upstream account as this user’s default on its server",
  request: {
    headers: TenantIdHeaderSchema,
    params: AccountIdParamSchema,
  },
  responses: {
    200: {
      description: "Updated account",
      content: {
        "application/json": { schema: MyAccessAccountResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...accountNotFound,
  },
});

const deleteAccount = createRoute({
  method: "delete",
  path: "/me/accounts/{accountId}",
  tags: ["My Access"],
  summary: "Disconnect one upstream account",
  request: {
    headers: TenantIdHeaderSchema,
    params: AccountIdParamSchema,
  },
  responses: {
    200: {
      description: "Account deleted",
      content: {
        "application/json": { schema: DeleteMyAccessCredentialResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...accountNotFound,
  },
});

export const myAccessRoutes = {
  listMyServers,
  upsertMyCredential,
  deleteMyCredential,
  renameAccount,
  makeDefaultAccount,
  deleteAccount,
} as const;
