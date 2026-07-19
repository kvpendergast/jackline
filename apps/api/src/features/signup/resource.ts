import { signupRoutes } from "./route.js";
import { signupServices } from "./service.js";

export const Signup = {
  routes: signupRoutes,
  services: signupServices,
} as const;
