import type { Feature } from "../../lib/feature.js";
import {
  createToolRouteHandler,
  deleteToolRouteHandler,
  getToolRouteHandler,
  listToolsRouteHandler,
  updateToolRouteHandler,
} from "./handler.js";
import {
  createToolRoute,
  deleteToolRoute,
  getToolRoute,
  listToolsRoute,
  updateToolRoute,
} from "./route.js";

export const toolsFeature: Feature = {
  name: "tools",
  routes: [
    { route: listToolsRoute, handler: listToolsRouteHandler },
    { route: createToolRoute, handler: createToolRouteHandler },
    { route: getToolRoute, handler: getToolRouteHandler },
    { route: updateToolRoute, handler: updateToolRouteHandler },
    { route: deleteToolRoute, handler: deleteToolRouteHandler },
  ],
};
