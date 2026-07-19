import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "./http/env.js";

export type FeatureRoute = {
  // RouteConfig is the createRoute return shape; handler is typed loosely at the registry boundary
  route: RouteConfig;
  handler: RouteHandler<any, MeshEnv>;
};

export type Feature = {
  name: string;
  routes: FeatureRoute[];
};
