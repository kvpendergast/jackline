import type { Feature } from "../../lib/feature.js";
import { signupRouteHandler } from "./handler.js";
import { signupRoute } from "./route.js";

export const signupFeature: Feature = {
  name: "signup",
  routes: [{ route: signupRoute, handler: signupRouteHandler }],
};
