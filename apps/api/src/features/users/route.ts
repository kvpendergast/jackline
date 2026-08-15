import { createRoute, z } from "@hono/zod-openapi";
import {
  cursorPageSchema,
  PublicUserSchema,
  UserKindSchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { PaginationQuerySchema } from "../../lib/http/pagination.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const UserIdParamSchema = z
  .object({
    id: z.string().min(1).openapi({
      param: { name: "id", in: "path" },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("UserIdParam");

const ListUsersQuerySchema = PaginationQuerySchema.extend({
  kind: UserKindSchema.optional().openapi({
    param: { name: "kind", in: "query" },
    description: "Filter by user kind",
  }),
}).openapi("ListUsersQuery");

const CreateServiceUserBodySchema = z
  .strictObject({
    kind: z.literal("service"),
    name: z.string().min(1),
    email: z.email().optional(),
  })
  .openapi("CreateServiceUserBody");

const UserResponseSchema = successEnvelopeSchema(
  PublicUserSchema,
  "UserResponse",
);

const UserListResponseSchema = successEnvelopeSchema(
  cursorPageSchema(PublicUserSchema),
  "UserListResponse",
);

const userNotFound = notFoundError("User not found in this tenant");

const list = createRoute({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "List users who are members of the active tenant",
  request: {
    headers: TenantIdHeaderSchema,
    query: ListUsersQuerySchema,
  },
  responses: {
    200: {
      description: "Cursor page of users (newest first)",
      content: {
        "application/json": { schema: UserListResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const create = createRoute({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Create a service user and add them to the tenant",
  description:
    "Creates `user.kind = service` with a tenant membership (`member`). Humans sign up via `/signup`. Optional email; otherwise a synthetic unique email is assigned.",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateServiceUserBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Service user created",
      content: {
        "application/json": { schema: UserResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const get = createRoute({
  method: "get",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Get a tenant member by user id",
  request: {
    headers: TenantIdHeaderSchema,
    params: UserIdParamSchema,
  },
  responses: {
    200: {
      description: "User",
      content: {
        "application/json": { schema: UserResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...userNotFound,
  },
});

export const userRoutes = {
  list,
  create,
  get,
} as const;
