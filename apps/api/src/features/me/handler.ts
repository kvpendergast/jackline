import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireSession } from "../../lib/request/index.js";
import { Me } from "./resource.js";

const get: RouteHandler<typeof Me.routes.get, MeshEnv> = async (c) => {
  const sessionResult = await requireSession(c);
  if (sessionResult.isErr()) {
    throw sessionResult.error;
  }

  const { ctx, user } = sessionResult.value;
  const result = await Me.services.get(ctx.log, user);
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const meHandlers = { get } as const;
