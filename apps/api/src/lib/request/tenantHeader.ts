import { z } from "@hono/zod-openapi";

/** OpenAPI / request validation for tenant-scoped routes. */
export const TenantIdHeaderSchema = z
  .object({
    "x-mesh-tenant-id": z.uuid().openapi({
      param: {
        name: "X-Mesh-Tenant-Id",
        in: "header",
      },
      example: "00000000-0000-4000-8000-000000000000",
    }),
  })
  .openapi("TenantIdHeader");
