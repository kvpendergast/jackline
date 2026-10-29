import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { oauthAppHandlers } from "./handler.js";
import { OAuthApp as OAuthAppCore } from "./resource.js";

export const OAuthApp = {
  routes: OAuthAppCore.routes,
  services: OAuthAppCore.services,
  handlers: oauthAppHandlers,
} as const;

/** `from-server` must be registered before `{id}` routes. */
const routeOrder = [
  "list",
  "create",
  "createFromServer",
  "get",
  "update",
  "delete",
] as const;

export const oauthAppsFeature: AppSlice = {
  name: "oauthApps",
  routes: featureRoutes(OAuthApp.routes, OAuthApp.handlers, routeOrder),
};
