import { serverRoutes } from "./route.js";
import { serverServices } from "./service.js";

export const Server = {
  routes: serverRoutes,
  services: serverServices,
} as const;
