import { OpenAPIHono } from "@hono/zod-openapi";
import { jacklineOnError } from "./mapError.js";
import { validationHook } from "./validationHook.js";
import type { JacklineEnv } from "./env.js";

export function createJacklineApp() {
  const app = new OpenAPIHono<JacklineEnv>({
    defaultHook: validationHook,
  });
  app.onError(jacklineOnError);
  return app;
}
