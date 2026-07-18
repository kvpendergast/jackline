import type { RouteHandler } from "@hono/zod-openapi";
import type { RouteConfig } from "@hono/zod-openapi";

export type FeatureRoute = {
  // RouteConfig is the createRoute return shape; handler is typed loosely at the registry boundary
  route: RouteConfig;
  handler: RouteHandler<any>;
};

export type Feature = {
  name: string;
  routes: FeatureRoute[];
};
