import { roleRoutes } from "./route.js";
import { roleServices } from "./service.js";

export const Role = {
  routes: roleRoutes,
  services: roleServices,
} as const;
