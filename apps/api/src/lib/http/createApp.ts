import { OpenAPIHono } from "@hono/zod-openapi";
import { meshOnError } from "./mapError.js";
import { validationHook } from "./validationHook.js";
import type { MeshEnv } from "./env.js";

export function createMeshApp() {
  const app = new OpenAPIHono<MeshEnv>({
    defaultHook: validationHook,
  });
  app.onError(meshOnError);
  return app;
}
