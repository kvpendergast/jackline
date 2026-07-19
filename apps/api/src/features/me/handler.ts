import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { meRoute } from "./route.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireSession } from "../../lib/request/index.js";
import { getMe } from "./service.js";

export const meRouteHandler: RouteHandler<typeof meRoute, MeshEnv> = async (c) => {
  const sessionResult = await requireSession(c);
  if (sessionResult.isErr()) {
    throw sessionResult.error;
  }

  const { ctx, user } = sessionResult.value;
  const getMeResult = await getMe(ctx.log, user);
  if (getMeResult.isErr()) {
    throw getMeResult.error;
  }

  return c.json(okEnvelope(getMeResult.value), 200);
};
