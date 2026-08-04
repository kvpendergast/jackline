import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { identityHandlers } from "./handler.js";
import { identityRoutes } from "./route.js";

const tenantOrder = [
  "getSso",
  "updateSso",
  "rotateScim",
  "listInvites",
  "createInvite",
  "listAdmins",
] as const;

const publicOrder = ["acceptInvite", "listLoginProviders"] as const;

export const identityTenantFeature: AppSlice = {
  name: "identity-settings",
  routes: featureRoutes(identityRoutes, identityHandlers, tenantOrder),
};

export const identityPublicFeature: AppSlice = {
  name: "identity-public",
  routes: featureRoutes(identityRoutes, identityHandlers, publicOrder),
};
