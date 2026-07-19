import type { MiddlewareHandler } from "hono";
import { ForbiddenError } from "@mesh/shared";
import type { MeshEnv } from "../http/env.js";

/** Requires `tenantContext.auth.membership.role === "full_admin"`. */
export const requireFullAdmin: MiddlewareHandler<MeshEnv> = async (c, next) => {
  const { auth } = c.get("tenantContext");
  if (auth.membership.role !== "full_admin") {
    throw new ForbiddenError("full_admin role required");
  }
  await next();
};
