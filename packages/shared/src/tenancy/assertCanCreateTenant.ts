import { err, ok, type Result } from "neverthrow";
import type { Env } from "../env/schema.js";
import { TenantLimitReachedError } from "../errors/index.js";

export function assertCanCreateTenant(
  tenantCount: number,
  mode: Env["MESH_TENANCY"],
): Result<void, TenantLimitReachedError> {
  if (mode === "single" && tenantCount >= 1) {
    return err(new TenantLimitReachedError());
  }
  return ok(undefined);
}
