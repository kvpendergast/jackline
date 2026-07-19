import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { meHandlers } from "./handler.js";
import { Me as MeCore } from "./resource.js";

export const Me = {
  routes: MeCore.routes,
  services: MeCore.services,
  handlers: meHandlers,
} as const;

export const meFeature: AppSlice = {
  name: "me",
  routes: featureRoutes(Me.routes, Me.handlers, ["get"] as const),
};
