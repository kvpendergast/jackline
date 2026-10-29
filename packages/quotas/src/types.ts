/** Named policy buckets shared by API, A2A, and gateway. */
export const QUOTA_BUCKETS = [
  "api.default",
  "api.auth",
  "a2a.directory",
  "a2a.card",
  "a2a.knock",
  "a2a.message",
  "gateway.mcp",
] as const;

export type QuotaBucket = (typeof QUOTA_BUCKETS)[number];

export type QuotaPolicy = {
  /** Max requests allowed in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export type QuotaPolicies = Record<QuotaBucket, QuotaPolicy>;

export type ConsumeResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSeconds: number;
  /** True when the backing store failed and we failed open. */
  degraded?: boolean;
};

export type QuotaStore = {
  /** Increment the counter for `key` within `windowSeconds`; return total in window. */
  increment(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }>;
  close?: () => Promise<void>;
};

export type QuotaLimiter = {
  consume(
    bucket: QuotaBucket,
    identityKeys: string[],
  ): Promise<ConsumeResult>;
  policies: QuotaPolicies;
  close?: () => Promise<void>;
};
