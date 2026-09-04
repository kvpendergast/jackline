import { createClient } from "redis";
import type { QuotaStore } from "../types.js";

export type RedisQuotaStoreOptions = {
  url: string;
  /** Key prefix so Jackline counters do not collide with other apps. */
  keyPrefix?: string;
};

type RedisCommands = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  quit(): Promise<unknown>;
  connect(): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

/**
 * Fixed-window counters in Redis (shared across replicas / clusters).
 * Uses INCR + EXPIRE on first hit in the window.
 */
export async function createRedisQuotaStore(
  options: RedisQuotaStoreOptions,
): Promise<QuotaStore> {
  const prefix = options.keyPrefix ?? "jackline:rl:";
  const client = createClient({ url: options.url }) as unknown as RedisCommands;
  client.on("error", () => {
    /* Errors surface on command; avoid unhandled 'error' crashes. */
  });
  await client.connect();

  return {
    async increment(key, windowSeconds) {
      const redisKey = `${prefix}${key}`;
      const count = await client.incr(redisKey);
      if (count === 1) {
        await client.expire(redisKey, windowSeconds);
      }
      const ttl = await client.ttl(redisKey);
      const ttlSeconds = ttl > 0 ? ttl : windowSeconds;
      return { count, ttlSeconds };
    },
    async close() {
      await client.quit().catch(() => undefined);
    },
  };
}
