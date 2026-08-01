import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { userHandlers } from "./handler.js";
import { User as UserCore } from "./resource.js";

export const User = {
  routes: UserCore.routes,
  services: UserCore.services,
  handlers: userHandlers,
} as const;

const routeOrder = ["list", "create", "get"] as const;

export const usersFeature: AppSlice = {
  name: "users",
  routes: featureRoutes(User.routes, User.handlers, routeOrder),
};
