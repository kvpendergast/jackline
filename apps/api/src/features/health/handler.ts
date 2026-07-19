import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { healthRoute } from "./route.js";

export const healthRouteHandler: RouteHandler<typeof healthRoute, MeshEnv> = (c) => {
  return c.json(okEnvelope({ ok: true as const }), 200);
};
