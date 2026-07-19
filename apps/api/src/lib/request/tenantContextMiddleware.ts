import type { MiddlewareHandler } from "hono";
import type { MeshEnv } from "../http/env.js";
import { requireTenantContext } from "./requireTenantContext.js";

/** Resolves session + X-Mesh-Tenant-Id membership into `tenantContext`. */
export const tenantContextMiddleware: MiddlewareHandler<MeshEnv> = async (
  c,
  next,
) => {
  const result = await requireTenantContext(c);
  if (result.isErr()) {
    throw result.error;
  }

  c.set("tenantContext", result.value);
  await next();
};
