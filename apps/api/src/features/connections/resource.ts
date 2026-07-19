import { connectionRoutes } from "./route.js";
import { connectionServices } from "./service.js";

export const Connection = {
  routes: connectionRoutes,
  services: connectionServices,
} as const;
