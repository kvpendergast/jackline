import { userRoutes } from "./route.js";
import { userServices } from "./service.js";

export const User = {
  routes: userRoutes,
  services: userServices,
} as const;
