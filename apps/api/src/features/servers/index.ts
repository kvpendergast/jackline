import type { Feature } from "../../lib/feature.js";
import {
  createServerRouteHandler,
  deleteServerRouteHandler,
  getServerRouteHandler,
  listServersRouteHandler,
  updateServerRouteHandler,
} from "./handler.js";
import {
  createServerRoute,
  deleteServerRoute,
  getServerRoute,
  listServersRoute,
  updateServerRoute,
} from "./route.js";

export const serversFeature: Feature = {
  name: "servers",
  routes: [
    { route: listServersRoute, handler: listServersRouteHandler },
    { route: createServerRoute, handler: createServerRouteHandler },
    { route: getServerRoute, handler: getServerRouteHandler },
    { route: updateServerRoute, handler: updateServerRouteHandler },
    { route: deleteServerRoute, handler: deleteServerRouteHandler },
  ],
};
