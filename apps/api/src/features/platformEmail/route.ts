import { createRoute } from "@hono/zod-openapi";
import {
  PublicPlatformEmailSettingsSchema,
  UpdatePlatformEmailSettingsBodySchema,
} from "@jackline/shared";
import { successEnvelopeSchema } from "../../lib/http/envelope.js";
import { tenantScopedErrors } from "../../lib/http/errorResponses.js";
import { requireFullAdmin } from "../../lib/request/requireFullAdmin.js";
import { TenantIdHeaderSchema } from "../../lib/request/tenantHeader.js";

const PlatformEmailResponseSchema = successEnvelopeSchema(
  PublicPlatformEmailSettingsSchema,
  "PlatformEmailSettingsResponse",
);

const get = createRoute({
  method: "get",
  path: "/platform/email",
  tags: ["Platform"],
  summary: "Get platform-wide outbound email connector settings",
  middleware: [requireFullAdmin] as const,
  request: { headers: TenantIdHeaderSchema },
  responses: {
    200: {
      description: "Platform email settings",
      content: {
        "application/json": { schema: PlatformEmailResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

const update = createRoute({
  method: "patch",
  path: "/platform/email",
  tags: ["Platform"],
  summary: "Update platform-wide outbound email connector settings",
  middleware: [requireFullAdmin] as const,
  request: {
    headers: TenantIdHeaderSchema,
    body: {
      content: {
        "application/json": { schema: UpdatePlatformEmailSettingsBodySchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated platform email settings",
      content: {
        "application/json": { schema: PlatformEmailResponseSchema },
      },
    },
    ...tenantScopedErrors,
  },
});

export const platformEmailRoutes = { get, update } as const;
