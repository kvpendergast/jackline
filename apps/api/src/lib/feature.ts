import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "./http/env.js";

export type FeatureRoute = {
  // RouteConfig is the createRoute return shape; handler is typed loosely at the registry boundary
  route: RouteConfig;
  handler: RouteHandler<any, JacklineEnv>;
};

export type AppSlice = {
  name: string;
  routes: FeatureRoute[];
};

/** Pair matching route/handler keys into an AppSlice route list (stable order). */
export function featureRoutes<const K extends string>(
  routes: Record<K, RouteConfig>,
  handlers: Record<K, RouteHandler<any, JacklineEnv>>,
  order: readonly K[],
): FeatureRoute[] {
  return order.map((key) => ({
    route: routes[key],
    handler: handlers[key],
  }));
}
