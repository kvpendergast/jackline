import {
  createQuotaLimiterFromEnv,
  createQuotaStore,
  type QuotaLimiter,
} from "@jackline/quotas";
import { SetupError } from "@jackline/shared";

let limiter: QuotaLimiter | undefined;

export async function initQuotas(redisUrl: string | undefined): Promise<void> {
  const store = await createQuotaStore({ redisUrl });
  limiter = createQuotaLimiterFromEnv(store, process.env);
}

export function getQuotaLimiter(): QuotaLimiter {
  if (!limiter) {
    throw new SetupError("Quota limiter not initialized");
  }
  return limiter;
}

export async function shutdownQuotas(): Promise<void> {
  await limiter?.close?.();
  limiter = undefined;
}
