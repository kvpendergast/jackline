import { featureRoutes, type AppSlice } from "../../lib/feature.js";
import { signupHandlers } from "./handler.js";
import { Signup as SignupCore } from "./resource.js";

export const Signup = {
  routes: SignupCore.routes,
  services: SignupCore.services,
  handlers: signupHandlers,
} as const;

export const signupFeature: AppSlice = {
  name: "signup",
  routes: featureRoutes(Signup.routes, Signup.handlers, ["create"] as const),
};
