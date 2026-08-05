import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { oauthHandlers } from "./handler.js";
import { oauthRoutes } from "./route.js";
import { oauthServices } from "./service.js";

export const Oauth = {
  routes: oauthRoutes,
  services: oauthServices,
  handlers: oauthHandlers,
} as const;

/** Tenant-scoped OAuth Connect start. */
export const oauthFeature: AppSlice = {
  name: "oauth",
  routes: featureRoutes(Oauth.routes, Oauth.handlers, ["start"] as const),
};
