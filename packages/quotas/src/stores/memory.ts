import type { QuotaStore } from "../types.js";

type WindowEntry = {
  count: number;
  resetAtMs: number;
};

/** Fixed-window counters in process memory (single replica). */
export function createMemoryQuotaStore(): QuotaStore {
  const windows = new Map<string, WindowEntry>();

  return {
    async increment(key, windowSeconds) {
      const now = Date.now();
      const existing = windows.get(key);

      if (!existing || existing.resetAtMs <= now) {
        const resetAtMs = now + windowSeconds * 1000;
        windows.set(key, { count: 1, resetAtMs });
        return { count: 1, ttlSeconds: windowSeconds };
      }

      existing.count += 1;
      const ttlSeconds = Math.max(
        1,
        Math.ceil((existing.resetAtMs - now) / 1000),
      );
      return { count: existing.count, ttlSeconds };
    },
  };
}
