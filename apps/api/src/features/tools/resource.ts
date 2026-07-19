import { toolRoutes } from "./route.js";
import { toolServices } from "./service.js";

export const Tool = {
  routes: toolRoutes,
  services: toolServices,
} as const;
