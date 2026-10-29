import { RateLimitedError } from "@jackline/shared";
import type { QuotaBucket, QuotaLimiter } from "./types.js";

/** Minimal request surface so quotas does not depend on a specific Hono version. */
export type QuotaHttpContext = {
  header(name: string, value: string): void;
};

/** Apply rate-limit headers from a consume result. */
export function applyQuotaHeaders(
  c: QuotaHttpContext,
  result: {
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
    allowed: boolean;
  },
): void {
  c.header("RateLimit-Limit", String(result.limit));
  c.header("RateLimit-Remaining", String(result.remaining));
  if (!result.allowed && result.retryAfterSeconds > 0) {
    c.header("Retry-After", String(result.retryAfterSeconds));
  }
}

/** Imperative check used by API/gateway handlers and thin Hono wrappers. */
export async function enforceQuota(
  c: QuotaHttpContext,
  limiter: QuotaLimiter,
  bucket: QuotaBucket,
  identityKeys: string[],
): Promise<void> {
  const result = await limiter.consume(bucket, identityKeys);
  applyQuotaHeaders(c, result);
  if (!result.allowed) {
    throw new RateLimitedError("Rate limit exceeded", result.retryAfterSeconds);
  }
}
