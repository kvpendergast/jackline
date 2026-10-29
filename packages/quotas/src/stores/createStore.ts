import { createMemoryQuotaStore } from "./memory.js";
import { createRedisQuotaStore } from "./redis.js";
import type { QuotaStore } from "../types.js";

export type CreateQuotaStoreOptions = {
  /** When set, use Redis; otherwise in-memory. */
  redisUrl?: string | undefined;
};

export async function createQuotaStore(
  options: CreateQuotaStoreOptions = {},
): Promise<QuotaStore> {
  const url = options.redisUrl?.trim();
  if (url) {
    return createRedisQuotaStore({ url });
  }
  return createMemoryQuotaStore();
}
