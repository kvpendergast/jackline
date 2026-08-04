import { createRoute, z } from "@hono/zod-openapi";
import {
  AcceptInviteBodySchema,
  CreateInviteBodySchema,
  PublicInviteSchema,
  PublicSsoConfigSchema,
  RotateScimTokenResultSchema,
  UpdateSsoConfigBodySchema,
} from "@mesh/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import { tenantScopedErrors } from "../../lib/http/errorResponses.js";
import { requireAdmin } from "../../lib/request/requireAdmin.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const SsoResponseSchema = successEnvelopeSchema(
  PublicSsoConfigSchema,
  "SsoConfigResponse",
);

const InviteResponseSchema = successEnvelopeSchema(
  PublicInviteSchema,
  "InviteResponse",
);

const InviteCreatedSchema = successEnvelopeSchema(
  z.strictObject({
    invite: PublicInviteSchema,
    token: z.string(),
  }),
  "InviteCreatedResponse",
);

const InviteListSchema = successEnvelopeSchema(
  z.object({ items: z.array(PublicInviteSchema) }),
  "InviteListResponse",
);

const AdminListSchema = successEnvelopeSchema(
  z.object({
    items: z.array(
      z.strictObject({
        membershipId: z.uuid(),
        userId: z.string(),
        email: z.email(),
        name: z.string(),
        role: z.string(),
        team: z.string().nullable(),
      }),
    ),
  }),
  "AdminListResponse",
);

const ScimRotateSchema = successEnvelopeSchema(
  RotateScimTokenResultSchema,
  "ScimRotateResponse",
);

const getSso = createRoute({
  method: "get",
  path: "/settings/sso",
  tags: ["Settings"],
  summary: "Get SSO / SCIM settings for the tenant",
  middleware: [requireFullAdmin] as const,
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "SSO config",
      content: { "application/json": { schema: SsoResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const updateSso = createRoute({
  method: "patch",
  path: "/settings/sso",
  tags: ["Settings"],
  summary: "Update SSO / SCIM settings",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: UpdateSsoConfigBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated SSO config",
      content: { "application/json": { schema: SsoResponseSchema } },
    },
    ...tenantScopedErrors,
  },
});

const rotateScim = createRoute({
  method: "post",
  path: "/settings/scim/token",
  tags: ["Settings"],
  summary: "Rotate SCIM bearer token (shown once)",
  middleware: [requireFullAdmin] as const,
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "New SCIM token",
      content: { "application/json": { schema: ScimRotateSchema } },
    },
    ...tenantScopedErrors,
  },
});

const listInvites = createRoute({
  method: "get",
  path: "/settings/invites",
  tags: ["Settings"],
  summary: "List pending invites",
  middleware: [requireAdmin] as const,
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "Pending invites",
      content: { "application/json": { schema: InviteListSchema } },
    },
    ...tenantScopedErrors,
  },
});

const createInvite = createRoute({
  method: "post",
  path: "/settings/invites",
  tags: ["Settings"],
  summary: "Create an invite (token returned once)",
  middleware: [requireAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: CreateInviteBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Invite created",
      content: { "application/json": { schema: InviteCreatedSchema } },
    },
    ...tenantScopedErrors,
  },
});

const listAdmins = createRoute({
  method: "get",
  path: "/settings/admins",
  tags: ["Settings"],
  summary: "List tenant memberships",
  middleware: [requireAdmin] as const,
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "Memberships",
      content: { "application/json": { schema: AdminListSchema } },
    },
    ...tenantScopedErrors,
  },
});

const acceptInvite = createRoute({
  method: "post",
  path: "/invites/accept",
  tags: ["Invites"],
  summary: "Accept an invite for the signed-in user",
  request: {
    body: {
      content: { "application/json": { schema: AcceptInviteBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Invite accepted",
      content: { "application/json": { schema: InviteResponseSchema } },
    },
  },
});

const listLoginProviders = createRoute({
  method: "get",
  path: "/sso/providers",
  tags: ["Settings"],
  summary: "List enabled SSO providers for the login screen",
  responses: {
    200: {
      description: "SSO providers",
      content: {
        "application/json": {
          schema: successEnvelopeSchema(
            z.object({
              items: z.array(
                z.strictObject({
                  providerId: z.string(),
                  label: z.string(),
                }),
              ),
            }),
            "SsoProvidersResponse",
          ),
        },
      },
    },
  },
});

export const identityRoutes = {
  getSso,
  updateSso,
  rotateScim,
  listInvites,
  createInvite,
  listAdmins,
  acceptInvite,
  listLoginProviders,
} as const;
