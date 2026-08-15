import type { Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import { auth, hashToken } from "@jackline/auth";
import { db, memberships, oauthAccessTokens } from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  JACKLINE_ACCESS_TOKEN_PREFIX,
  JacklineError,
  UnauthorizedError,
} from "@jackline/shared";
import type { JacklineEnv } from "../http/env.js";
import type { AuthContext, RequestContext } from "./types.js";

function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

async function resolveBearerAuth(
  c: Context<JacklineEnv>,
  accessToken: string,
): Promise<Result<AuthContext, JacklineError>> {
  if (!accessToken.startsWith(JACKLINE_ACCESS_TOKEN_PREFIX)) {
    return err(new UnauthorizedError("Invalid access token"));
  }

  const tokenHash = hashToken(accessToken);
  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.tokenHash, tokenHash),
        isNull(oauthAccessTokens.revokedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return err(new UnauthorizedError("Invalid access token"));
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return err(new UnauthorizedError("Access token expired"));
  }

  const headerTenantId = c.req.header("X-Jackline-Tenant-Id")?.trim();
  if (headerTenantId && headerTenantId !== row.tenantId) {
    return err(
      new ForbiddenError("X-Jackline-Tenant-Id does not match the access token tenant"),
    );
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, row.userId),
        eq(memberships.tenantId, row.tenantId),
      ),
    )
    .limit(1);

  if (!membership) {
    return err(new ForbiddenError("Token subject is not a member of this tenant"));
  }

  return ok({
    userId: row.userId,
    tenantId: row.tenantId,
    membership: {
      id: membership.id,
      role: membership.role,
      team: membership.team,
    },
    method: "oauth_client_credentials",
    clientId: row.clientId,
  });
}

async function resolveSessionAuth(
  c: Context<JacklineEnv>,
): Promise<Result<AuthContext, JacklineError>> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return err(new UnauthorizedError("No session"));
  }

  const tenantId = c.req.header("X-Jackline-Tenant-Id")?.trim();
  if (!tenantId) {
    return err(new BadRequestError("X-Jackline-Tenant-Id header is required"));
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

  return ok({
    userId: session.user.id,
    tenantId,
    membership: {
      id: membership.id,
      role: membership.role,
      team: membership.team,
    },
    method: "session",
  });
}

export async function requireTenantContext(
  c: Context<JacklineEnv>,
): Promise<Result<RequestContext, JacklineError>> {
  const base = c.get("requestContext");
  const bearer = extractBearer(c.req.header("Authorization"));

  const authResult = bearer
    ? await resolveBearerAuth(c, bearer)
    : await resolveSessionAuth(c);

  if (authResult.isErr()) {
    return err(authResult.error);
  }

  const authContext = authResult.value;
  const log = base.log.child({
    tenantId: authContext.tenantId,
    userId: authContext.userId,
    authMethod: authContext.method,
    ...(authContext.clientId ? { oauthClientId: authContext.clientId } : {}),
  });

  return ok({
    requestId: base.requestId,
    ...(base.traceId ? { traceId: base.traceId } : {}),
    auth: authContext,
    log,
  });
}
