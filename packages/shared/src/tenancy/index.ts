import { ok, type Result } from "neverthrow";
import type { Env } from "../env/schema.js";

export { assertCanCreateTenant } from "./assertCanCreateTenant.js";

export function isSingleTenancy(jacklineTenancy: Env['JACKLINE_TENANCY']): Result<boolean, never> {
    return ok(jacklineTenancy === "single");
}

export function isMultiTenancy(jacklineTenancy: Env['JACKLINE_TENANCY']): Result<boolean, never> {
    return ok(jacklineTenancy === "multi");
}