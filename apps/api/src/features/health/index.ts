import type { Feature } from "../../lib/feature.js";
import { healthRouteHandler } from "./handler.js";
import { healthRoute } from "./route.js";

export const healthFeature: Feature = {
  name: "health",
  routes: [{ route: healthRoute, handler: healthRouteHandler }],
};
