import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { roleHandlers } from "./handler.js";
import { Role as RoleCore } from "./resource.js";

export const Role = {
  routes: RoleCore.routes,
  services: RoleCore.services,
  handlers: roleHandlers,
} as const;

const routeOrder = [
  "list",
  "create",
  "get",
  "update",
  "delete",
  "attachTool",
  "setTools",
  "detachTool",
] as const;

export const rolesFeature: AppSlice = {
  name: "roles",
  routes: featureRoutes(Role.routes, Role.handlers, routeOrder),
};
