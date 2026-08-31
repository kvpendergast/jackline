import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { authCompleteHandlers } from "./handler.js";
import { AuthComplete as AuthCompleteCore } from "./resource.js";

export const AuthComplete = {
  routes: AuthCompleteCore.routes,
  services: AuthCompleteCore.services,
  handlers: authCompleteHandlers,
} as const;

export const authCompleteFeature: AppSlice = {
  name: "authComplete",
  routes: featureRoutes(
    AuthComplete.routes,
    AuthComplete.handlers,
    ["complete"] as const,
  ),
};
