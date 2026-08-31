import { authCompleteRoutes } from "./route.js";
import { authCompleteServices } from "./service.js";

export const AuthComplete = {
  routes: authCompleteRoutes,
  services: authCompleteServices,
} as const;
