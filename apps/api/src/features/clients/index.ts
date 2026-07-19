import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { clientHandlers } from "./handler.js";
import { Client as ClientCore } from "./resource.js";

export const Client = {
  routes: ClientCore.routes,
  services: ClientCore.services,
  handlers: clientHandlers,
} as const;

const routeOrder = ["list", "create", "get", "update", "delete"] as const;

export const clientsFeature: AppSlice = {
  name: "clients",
  routes: featureRoutes(Client.routes, Client.handlers, routeOrder),
};
