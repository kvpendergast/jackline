import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Health } from "./resource.js";

const get: RouteHandler<typeof Health.routes.get, JacklineEnv> = (c) => {
  return c.json(okEnvelope({ ok: true as const }), 200);
};

export const healthHandlers = { get } as const;
