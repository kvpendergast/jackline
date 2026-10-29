import { createHash } from "node:crypto";
import type {
  ConsumeResult,
  QuotaBucket,
  QuotaLimiter,
  QuotaPolicies,
  QuotaStore,
} from "./types.js";
import { DEFAULT_QUOTA_POLICIES, resolveQuotaPolicies } from "./policies.js";

export type CreateQuotaLimiterOptions = {
  store: QuotaStore;
  policies?: QuotaPolicies;
  /**
   * When the store throws, allow the request (fail-open) instead of 429/503.
   * Default true — rate limits protect capacity; they should not take the API down.
   */
  failOpen?: boolean;
};

function fingerprintIdentities(identityKeys: string[]): string {
  const normalized = identityKeys
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized || "anonymous").digest("hex").slice(0, 32);
}

export function createQuotaLimiter(
  options: CreateQuotaLimiterOptions,
): QuotaLimiter {
  const policies = options.policies ?? DEFAULT_QUOTA_POLICIES;
  const failOpen = options.failOpen !== false;
  const { store } = options;

  return {
    policies,
    async consume(bucket, identityKeys): Promise<ConsumeResult> {
      const policy = policies[bucket];
      const identity = fingerprintIdentities(identityKeys);
      const key = `${bucket}:${identity}`;

      try {
        const { count, ttlSeconds } = await store.increment(
          key,
          policy.windowSeconds,
        );
        const allowed = count <= policy.limit;
        return {
          allowed,
          limit: policy.limit,
          remaining: Math.max(0, policy.limit - count),
          retryAfterSeconds: allowed ? 0 : Math.max(1, ttlSeconds),
        };
      } catch {
        if (failOpen) {
          return {
            allowed: true,
            limit: policy.limit,
            remaining: policy.limit,
            retryAfterSeconds: 0,
            degraded: true,
          };
        }
        return {
          allowed: false,
          limit: policy.limit,
          remaining: 0,
          retryAfterSeconds: Math.max(1, policy.windowSeconds),
        };
      }
    },
    async close() {
      await store.close?.();
    },
  };
}

/** Build policies from env, then wrap a store. */
export function createQuotaLimiterFromEnv(
  store: QuotaStore,
  env: NodeJS.ProcessEnv = process.env,
): QuotaLimiter {
  return createQuotaLimiter({
    store,
    policies: resolveQuotaPolicies(env),
  });
}

export type { QuotaBucket };
