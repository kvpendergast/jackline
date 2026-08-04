import { signupFeature } from "./features/signup/index.js";
import { healthFeature } from "./features/health/index.js";
import type { AppSlice } from "./lib/feature.js";
import { meFeature } from "./features/me/index.js";
import { auditEventsFeature } from "./features/auditEvents/index.js";
import { clientsFeature } from "./features/clients/index.js";
import { connectionsFeature } from "./features/connections/index.js";
import {
  identityPublicFeature,
  identityTenantFeature,
} from "./features/identity/index.js";
import { rolesFeature } from "./features/roles/index.js";
import { secretsFeature } from "./features/secrets/index.js";
import { serversFeature } from "./features/servers/index.js";
import { toolsFeature } from "./features/tools/index.js";
import { usersFeature } from "./features/users/index.js";

export type { AppSlice, FeatureRoute } from "./lib/feature.js";

/** Public `/api/v1` routes (no tenant header). */
export const publicV1Features: AppSlice[] = [
  signupFeature,
  meFeature,
  identityPublicFeature,
];

/** Tenant-scoped `/api/v1` routes (`X-Mesh-Tenant-Id` + membership). */
export const tenantV1Features: AppSlice[] = [
  usersFeature,
  serversFeature,
  toolsFeature,
  rolesFeature,
  clientsFeature,
  connectionsFeature,
  secretsFeature,
  auditEventsFeature,
  identityTenantFeature,
];

/** Unversioned routes (health probes, etc.). */
export const rootFeatures: AppSlice[] = [healthFeature];
