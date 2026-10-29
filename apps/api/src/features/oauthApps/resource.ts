import { oauthAppRoutes } from "./route.js";
import { oauthAppServices } from "./service.js";

export const OAuthApp = {
  routes: oauthAppRoutes,
  services: oauthAppServices,
} as const;
