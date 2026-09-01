import { platformEmailRoutes } from "./route.js";
import { platformEmailServices } from "./service.js";

export const PlatformEmail = {
  routes: platformEmailRoutes,
  services: platformEmailServices,
} as const;
