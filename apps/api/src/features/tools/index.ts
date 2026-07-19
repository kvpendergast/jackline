import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { toolHandlers } from "./handler.js";
import { Tool as ToolCore } from "./resource.js";

export const Tool = {
  routes: ToolCore.routes,
  services: ToolCore.services,
  handlers: toolHandlers,
} as const;

const routeOrder = ["list", "create", "get", "update", "delete"] as const;

export const toolsFeature: AppSlice = {
  name: "tools",
  routes: featureRoutes(Tool.routes, Tool.handlers, routeOrder),
};
