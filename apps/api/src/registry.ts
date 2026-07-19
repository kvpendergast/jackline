import { signupFeature } from "./features/signup/index.js";
import { healthFeature } from "./features/health/index.js";
import type { AppSlice } from "./lib/feature.js";
import { meFeature } from "./features/me/index.js";
import { rolesFeature } from "./features/roles/index.js";
import { serversFeature } from "./features/servers/index.js";
import { toolsFeature } from "./features/tools/index.js";

export type { AppSlice, FeatureRoute } from "./lib/feature.js";

/** Public `/api/v1` routes (no tenant header). */
export const publicV1Features: AppSlice[] = [signupFeature, meFeature];

/** Tenant-scoped `/api/v1` routes (`X-Mesh-Tenant-Id` + membership). */
export const tenantV1Features: AppSlice[] = [
  serversFeature,
  toolsFeature,
  rolesFeature,
];

/** Unversioned routes (health probes, etc.). */
export const rootFeatures: AppSlice[] = [healthFeature];
