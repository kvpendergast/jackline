import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { connectionHandlers } from "./handler.js";
import { Connection as ConnectionCore } from "./resource.js";

export const Connection = {
  routes: ConnectionCore.routes,
  services: ConnectionCore.services,
  handlers: connectionHandlers,
} as const;

const routeOrder = [
  "list",
  "create",
  "get",
  "update",
  "delete",
  "attachRole",
  "setRoles",
  "detachRole",
  "attachToolOverride",
  "setToolOverrides",
  "detachToolOverride",
] as const;

export const connectionsFeature: AppSlice = {
  name: "connections",
  routes: featureRoutes(Connection.routes, Connection.handlers, routeOrder),
};
