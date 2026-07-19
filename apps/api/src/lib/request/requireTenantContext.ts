import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import { auth } from "@mesh/auth";
import { db, memberships } from "@mesh/db";
import {
  BadRequestError,
  ForbiddenError,
  MeshError,
  UnauthorizedError,
} from "@mesh/shared";
import type { MeshEnv } from "../http/env.js";
import type { AuthContext, RequestContext } from "./types.js";

export type RequireTenantOptions = {
  /** When true, membership.role must be `full_admin`. */
  requireFullAdmin?: boolean;
};

export async function requireTenantContext(
  c: Context<MeshEnv>,
  options: RequireTenantOptions = {},
): Promise<Result<RequestContext, MeshError>> {
  const base = c.get("requestContext");

  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return err(new UnauthorizedError("No session"));
  }

  const tenantId = c.req.header("X-Mesh-Tenant-Id")?.trim();
  if (!tenantId) {
    return err(new BadRequestError("X-Mesh-Tenant-Id header is required"));
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(memberships.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!membership) {
    return err(new ForbiddenError("Not a member of this tenant"));
  }

  if (options.requireFullAdmin && membership.role !== "full_admin") {
    return err(new ForbiddenError("full_admin role required"));
  }

  const authContext: AuthContext = {
    userId: session.user.id,
    tenantId,
    membership: { id: membership.id, role: membership.role },
    method: "session",
  };

  const log = base.log.child({
    tenantId: authContext.tenantId,
    userId: authContext.userId,
    authMethod: authContext.method,
  });

  return ok({
    requestId: base.requestId,
    ...(base.traceId ? { traceId: base.traceId } : {}),
    auth: authContext,
    log,
  });
}
