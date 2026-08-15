import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { mcpOauthHandlers } from "./handler.js";
import { mcpOauthRoutes } from "./route.js";
import { mcpOauthServices } from "./service.js";

export const McpOauth = {
  routes: mcpOauthRoutes,
  services: mcpOauthServices,
  handlers: mcpOauthHandlers,
} as const;

export const mcpOauthFeature: AppSlice = {
  name: "mcpOauth",
  routes: featureRoutes(
    McpOauth.routes,
    McpOauth.handlers,
    [
      "createClient",
      "listClients",
      "getClient",
      "updateRedirects",
      "rotateSecret",
      "revokeClient",
      "revokeSessions",
    ] as const,
  ),
};
