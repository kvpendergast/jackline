import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { healthHandlers } from "./handler.js";
import { Health as HealthCore } from "./resource.js";

export const Health = {
  routes: HealthCore.routes,
  handlers: healthHandlers,
} as const;

export const healthFeature: AppSlice = {
  name: "health",
  routes: featureRoutes(Health.routes, Health.handlers, ["get"] as const),
};
