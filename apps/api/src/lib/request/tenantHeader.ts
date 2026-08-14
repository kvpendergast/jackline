import { z } from "@hono/zod-openapi";

/**
 * OpenAPI / request validation for tenant-scoped routes.
 * Required for session cookie auth; optional when using a Bearer access token
 * (tenant is taken from the token; header must match if present).
 */
export const TenantIdHeaderSchema = z
  .object({
    "x-mesh-tenant-id": z.uuid().optional().openapi({
      param: {
        name: "X-Mesh-Tenant-Id",
        in: "header",
        required: false,
      },
      example: "00000000-0000-4000-8000-000000000000",
      description:
        "Required for session auth. Optional for OAuth2 Bearer tokens (must match token tenant if set).",
    }),
  })
  .openapi("TenantIdHeader");
