import type { Context } from "hono";
import {
  clientIpFromHeaders,
  enforceQuota,
  type QuotaBucket,
} from "@jackline/quotas";
import type { JacklineEnv } from "../http/env.js";
import { getQuotaLimiter } from "../quotas.js";

function authIdentityKeys(c: Context<JacklineEnv>): string[] {
  const tenant = c.get("tenantContext");
  if (tenant?.auth) {
    const keys = [
      `tenant:${tenant.auth.tenantId}`,
      `user:${tenant.auth.userId}`,
    ];
    if (tenant.auth.clientId) {
      keys.push(`client:${tenant.auth.clientId}`);
    }
    return keys;
  }
  return [`ip:${clientIpFromHeaders((name) => c.req.header(name))}`];
}

function bucketForTenantPath(path: string): QuotaBucket {
  if (
    path.endsWith("/networks/public/directory") ||
    path.endsWith("/agent-registry")
  ) {
    return "a2a.directory";
  }
  if (path.endsWith("/trust/exchange")) {
    return "a2a.knock";
  }
  return "api.default";
}

/** Rate limit for unauthenticated / pre-tenant routes (keyed by IP). */
export function ipQuotaMiddleware(bucket: QuotaBucket) {
  return async (c: Context, next: () => Promise<void>) => {
    await enforceQuota(c, getQuotaLimiter(), bucket, [
      `ip:${clientIpFromHeaders((name) => c.req.header(name))}`,
    ]);
    await next();
  };
}

/**
 * Rate limit after tenant auth.
 * Picks a2a.* buckets for directory/exchange; otherwise api.default.
 */
export function tenantQuotaMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    const bucket = bucketForTenantPath(c.req.path);
    await enforceQuota(
      c,
      getQuotaLimiter(),
      bucket,
      authIdentityKeys(c as Context<JacklineEnv>),
    );
    await next();
  };
}
