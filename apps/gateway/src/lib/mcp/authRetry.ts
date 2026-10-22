import { err, ok, type Result } from "neverthrow";
import type { JacklineError } from "@jackline/shared";

/** One upstream attempt's failure; `authRejected` = upstream said 401 / invalid_token. */
export type UpstreamAttemptFailure = {
  error: JacklineError;
  authRejected: boolean;
};

/**
 * Run an upstream call; if the upstream rejects the bearer, force one OAuth
 * refresh and retry exactly once. A second rejection with a freshly minted
 * token means the grant itself is unusable → `expiredError()` (reconnect).
 * Refresh failures (reauth / transient) surface from `attempt(true)` as
 * non-`authRejected` failures and are returned unchanged.
 */
export async function callWithAuthRetry<T>(input: {
  attempt: (forceRefresh: boolean) => Promise<Result<T, UpstreamAttemptFailure>>;
  expiredError: () => JacklineError;
  onRetry?: () => void;
}): Promise<Result<T, JacklineError>> {
  const first = await input.attempt(false);
  if (first.isOk()) return ok(first.value);
  if (!first.error.authRejected) return err(first.error.error);

  input.onRetry?.();
  const retry = await input.attempt(true);
  if (retry.isOk()) return ok(retry.value);
  if (retry.error.authRejected) return err(input.expiredError());
  return err(retry.error.error);
}
