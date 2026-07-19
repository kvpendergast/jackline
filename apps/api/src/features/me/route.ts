import { createRoute, z } from "@hono/zod-openapi";
import {
  PublicMembershipSchema,
  PublicTenantSchema,
  PublicUserSchema,
} from "@mesh/shared";
import {
  ErrorEnvelopeSchema,
  successEnvelopeSchema,
} from "../../lib/http/envelope.js";

const MembershipContextSchema = PublicMembershipSchema.omit({
  userId: true,
  tenantId: true,
})
  .extend({
    tenant: PublicTenantSchema,
  })
  .openapi("MembershipContext");

const MeDataOpenApiSchema = z
  .strictObject({
    user: PublicUserSchema,
    memberships: z.array(MembershipContextSchema),
  })
  .openapi("MeData");

export const MeResponseSchema = successEnvelopeSchema(
  MeDataOpenApiSchema,
  "MeResponse",
);

const get = createRoute({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  summary: "Current user and membership contexts",
  responses: {
    200: {
      description: "Authenticated session context",
      content: {
        "application/json": {
          schema: MeResponseSchema,
        },
      },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    500: {
      description: "Internal error",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  },
});

export const meRoutes = { get } as const;
