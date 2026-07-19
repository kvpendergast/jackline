import { clientRoutes } from "./route.js";
import { clientServices } from "./service.js";

export const Client = {
  routes: clientRoutes,
  services: clientServices,
} as const;
