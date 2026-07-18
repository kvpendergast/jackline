import type { RouteHandler } from "@hono/zod-openapi";
import { okEnvelope } from "../../lib/http/envelope.js";
import { healthRoute } from "./route.js";

export const healthRouteHandler: RouteHandler<typeof healthRoute> = (c) => {
  return c.json(okEnvelope({ ok: true as const }), 200);
};
