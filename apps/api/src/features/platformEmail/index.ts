import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { platformEmailHandlers } from "./handler.js";
import { platformEmailRoutes } from "./route.js";

const tenantOrder = ["get", "update"] as const;
const publicOrder = ["getStatus"] as const;

export const platformEmailTenantFeature: AppSlice = {
  name: "platformEmail",
  routes: featureRoutes(platformEmailRoutes, platformEmailHandlers, tenantOrder),
};

export const platformEmailPublicFeature: AppSlice = {
  name: "platformEmail-public",
  routes: featureRoutes(platformEmailRoutes, platformEmailHandlers, publicOrder),
};

/** @deprecated use platformEmailTenantFeature */
export const platformEmailFeature = platformEmailTenantFeature;
