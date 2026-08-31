import { createRoute } from "@hono/zod-openapi";
import {
  AuthCompleteBodySchema,
  AuthCompleteResultSchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";

const AuthCompleteResponseSchema = successEnvelopeSchema(
  AuthCompleteResultSchema,
  "AuthCompleteResponse",
);

const complete = createRoute({
  method: "post",
  path: "/auth/complete",
  tags: ["Auth"],
  summary: "Resolve post-login/signup routing (SSO enforcement, domain join)",
  request: {
    body: {
      content: { "application/json": { schema: AuthCompleteBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Next auth step for the client",
      content: {
        "application/json": { schema: AuthCompleteResponseSchema },
      },
    },
  },
});

export const authCompleteRoutes = { complete } as const;
