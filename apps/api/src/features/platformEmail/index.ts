import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { platformEmailHandlers } from "./handler.js";
import { platformEmailRoutes } from "./route.js";

const order = ["get", "update"] as const;

export const platformEmailFeature: AppSlice = {
  name: "platformEmail",
  routes: featureRoutes(platformEmailRoutes, platformEmailHandlers, order),
};
