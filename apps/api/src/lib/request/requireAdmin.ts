import type { MiddlewareHandler } from "hono";
import { ForbiddenError, type MembershipRole } from "@mesh/shared";
import type { MeshEnv } from "../http/env.js";

export function isAdminRole(role: string): role is MembershipRole {
  return role === "full_admin" || role === "delegated_admin";
}

/** full_admin or delegated_admin. */
export const requireAdmin: MiddlewareHandler<MeshEnv> = async (c, next) => {
  const { auth } = c.get("tenantContext");
  if (!isAdminRole(auth.membership.role)) {
    throw new ForbiddenError("admin role required");
  }
  await next();
};
