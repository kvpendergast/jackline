import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { serverHandlers } from "./handler.js";
import { Server as ServerCore } from "./resource.js";

export const Server = {
  routes: ServerCore.routes,
  services: ServerCore.services,
  handlers: serverHandlers,
} as const;

const routeOrder = [
  "list",
  "create",
  "get",
  "update",
  "syncTools",
  "delete",
] as const;

export const serversFeature: AppSlice = {
  name: "servers",
  routes: featureRoutes(Server.routes, Server.handlers, routeOrder),
};
