import type { Feature } from "../../lib/feature.js";
import { meRouteHandler } from "./handler.js";
import { meRoute } from "./route.js";

export const meFeature: Feature = {
  name: "me",
  routes: [{ route: meRoute, handler: meRouteHandler }],
};
