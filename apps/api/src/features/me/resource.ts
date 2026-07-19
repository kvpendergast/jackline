import { meRoutes } from "./route.js";
import { meServices } from "./service.js";

export const Me = {
  routes: meRoutes,
  services: meServices,
} as const;
