import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { chatHandlers } from "./handler.js";
import { chatRoutes } from "./route.js";

const routeOrder = [
  "getSession",
  "getSettings",
  "updateSettings",
  "run",
] as const;

export const chatFeature: AppSlice = {
  name: "chat",
  routes: featureRoutes(chatRoutes, chatHandlers, routeOrder),
};
