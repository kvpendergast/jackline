import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { secretHandlers } from "./handler.js";
import { Secret as SecretCore } from "./resource.js";

export const Secret = {
  routes: SecretCore.routes,
  services: SecretCore.services,
  handlers: secretHandlers,
} as const;

const routeOrder = [
  "list",
  "create",
  "reveal",
  "get",
  "update",
  "delete",
] as const;

export const secretsFeature: AppSlice = {
  name: "secrets",
  routes: featureRoutes(Secret.routes, Secret.handlers, routeOrder),
};
