import { secretRoutes } from "./route.js";
import { secretServices } from "./service.js";

export const Secret = {
  routes: secretRoutes,
  services: secretServices,
} as const;
