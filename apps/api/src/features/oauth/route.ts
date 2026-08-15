import { createRoute, z } from "@hono/zod-openapi";
import {
  StartOauthBodySchema,
  StartOauthResultSchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import {
  notFoundError,
  tenantScopedErrors,
} from "../../lib/http/errorResponses.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const StartOauthResponseSchema = successEnvelopeSchema(
  StartOauthResultSchema,
  "StartOauthResponse",
);

const start = createRoute({
  method: "post",
  path: "/oauth/start",
  tags: ["OAuth"],
  summary: "Start upstream OAuth Connect for a server (returns authorize URL)",
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: { "application/json": { schema: StartOauthBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Browser authorize URL",
      content: {
        "application/json": { schema: StartOauthResponseSchema },
      },
    },
    ...tenantScopedErrors,
    ...notFoundError("Server not found"),
  },
});

/** Browser redirect target — not OpenAPI JSON; registered separately in app if needed. */
const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const oauthRoutes = {
  start,
} as const;

export const oauthCallbackQuerySchema = callbackQuerySchema;
