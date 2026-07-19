import { signupFeature } from "./features/signup/index.js";
import { healthFeature } from "./features/health/index.js";
import type { Feature } from "./lib/feature.js";
import { meFeature } from "./features/me/index.js";
import { serversFeature } from "./features/servers/index.js";
import { toolsFeature } from "./features/tools/index.js";

export type { Feature, FeatureRoute } from "./lib/feature.js";

/** Public `/api/v1` routes (no tenant header). */
export const publicV1Features: Feature[] = [signupFeature, meFeature];

/** Tenant-scoped `/api/v1` routes (`X-Mesh-Tenant-Id` + membership). */
export const tenantV1Features: Feature[] = [serversFeature, toolsFeature];

/** Unversioned routes (health probes, etc.). */
export const rootFeatures: Feature[] = [healthFeature];
