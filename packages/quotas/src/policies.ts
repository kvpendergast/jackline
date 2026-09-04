import type { QuotaBucket, QuotaPolicies, QuotaPolicy } from "./types.js";
import { QUOTA_BUCKETS } from "./types.js";

/** Built-in defaults — operators override via JACKLINE_RL_* env vars. */
export const DEFAULT_QUOTA_POLICIES: QuotaPolicies = {
  "api.default": { limit: 120, windowSeconds: 60 },
  "api.auth": { limit: 30, windowSeconds: 60 },
  "a2a.directory": { limit: 60, windowSeconds: 60 },
  "a2a.card": { limit: 60, windowSeconds: 60 },
  "a2a.knock": { limit: 10, windowSeconds: 3600 },
  "a2a.message": { limit: 120, windowSeconds: 60 },
  "gateway.mcp": { limit: 300, windowSeconds: 60 },
};

/** `api.default` → `API_DEFAULT` for env suffix. */
export function bucketToEnvSuffix(bucket: QuotaBucket): string {
  return bucket.replace(/\./g, "_").toUpperCase();
}

export function parseWindowSeconds(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const match = /^(\d+)(s|m|h|d)?$/.exec(trimmed);
  if (!match?.[1]) return null;

  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = match[2] ?? "s";
  switch (unit) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      return null;
  }
}

/**
 * Merge built-in defaults with `JACKLINE_RL_<BUCKET>_LIMIT` / `_WINDOW` env overrides.
 * Unknown `JACKLINE_RL_*` keys are ignored.
 */
export function resolveQuotaPolicies(
  env: NodeJS.ProcessEnv = process.env,
  defaults: QuotaPolicies = DEFAULT_QUOTA_POLICIES,
): QuotaPolicies {
  const policies = { ...defaults };

  for (const bucket of QUOTA_BUCKETS) {
    const suffix = bucketToEnvSuffix(bucket);
    const limitRaw = env[`JACKLINE_RL_${suffix}_LIMIT`];
    const windowRaw = env[`JACKLINE_RL_${suffix}_WINDOW`];

    const next: QuotaPolicy = { ...policies[bucket] };

    if (limitRaw !== undefined && limitRaw.trim() !== "") {
      const limit = Number(limitRaw);
      if (Number.isFinite(limit) && limit > 0) {
        next.limit = Math.floor(limit);
      }
    }

    if (windowRaw !== undefined && windowRaw.trim() !== "") {
      const windowSeconds = parseWindowSeconds(windowRaw);
      if (windowSeconds !== null) {
        next.windowSeconds = windowSeconds;
      }
    }

    policies[bucket] = next;
  }

  return policies;
}
