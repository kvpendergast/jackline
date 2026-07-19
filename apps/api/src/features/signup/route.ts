import { createRoute, z } from "@hono/zod-openapi";
import {
  ErrorEnvelopeSchema,
  successEnvelopeSchema,
} from "../../lib/http/envelope.js";
import { PublicMembershipSchema, PublicTenantSchema, PublicUserSchema } from "@mesh/shared";

const SignupBodySchema = z
  .strictObject({
    email: z.email(),
    password: z.string().min(8),
    name: z.string().min(1),
    organizationName: z.string().min(1),
  })
  .openapi("SignupBody");

const SignupDataSchema = z
  .strictObject({
    user: PublicUserSchema,
    tenant: PublicTenantSchema,
    membership: PublicMembershipSchema,
  })
  .openapi("SignupData");

const SignupResponseSchema = successEnvelopeSchema(
  SignupDataSchema,
  "SignupResponse",
);

const create = createRoute({
  method: "post",
  path: "/signup",
  tags: ["Auth"],
  summary: "Create organization and first admin user",
  request: {
    body: {
      content: { "application/json": { schema: SignupBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Organization created",
      content: {
        "application/json": {
          schema: SignupResponseSchema,
        },
      },
    },
    400: {
      description: "Validation or signup error",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    409: {
      description: "Tenant limit reached",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    500: {
      description: "Internal error",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  },
});

export const signupRoutes = { create } as const;
