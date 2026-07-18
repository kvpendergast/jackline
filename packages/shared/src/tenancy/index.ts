import { ok, type Result } from "neverthrow";
import type { Env } from "../env/schema.js";

export { assertCanCreateTenant } from "./assertCanCreateTenant.js";

export function isSingleTenancy(meshTenancy: Env['MESH_TENANCY']): Result<boolean, never> {
    return ok(meshTenancy === "single");
}

export function isMultiTenancy(meshTenancy: Env['MESH_TENANCY']): Result<boolean, never> {
    return ok(meshTenancy === "multi");
}