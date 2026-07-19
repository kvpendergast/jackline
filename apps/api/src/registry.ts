import { signupFeature } from "./features/signup/index.js";
import { healthFeature } from "./features/health/index.js";
import type { Feature } from "./lib/feature.js";
import { meFeature } from "./features/me/index.js";
import { serversFeature } from "./features/servers/index.js";

export type { Feature, FeatureRoute } from "./lib/feature.js";

/** Mesh control-plane routes mounted at `/api/v1`. */
export const v1Features: Feature[] = [signupFeature, meFeature, serversFeature];

/** Unversioned routes (health probes, etc.). */
export const rootFeatures: Feature[] = [healthFeature];
