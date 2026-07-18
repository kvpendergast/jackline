import { OpenAPIHono } from "@hono/zod-openapi";
import { meshOnError } from "./mapError.js";
import { validationHook } from "./validationHook.js";

export function createMeshApp() {
  const app = new OpenAPIHono({
    defaultHook: validationHook,
  });
  app.onError(meshOnError);
  return app;
}
