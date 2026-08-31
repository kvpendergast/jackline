import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireSession } from "../../lib/request/index.js";
import { AuthComplete } from "./resource.js";

const complete: RouteHandler<
  typeof AuthComplete.routes.complete,
  JacklineEnv
> = async (c) => {
  const sessionResult = await requireSession(c);
  if (sessionResult.isErr()) {
    throw sessionResult.error;
  }

  const { ctx, user } = sessionResult.value;
  const body = c.req.valid("json");
  const result = await AuthComplete.services.complete(
    ctx.log,
    user,
    body,
    c.req.header("cookie"),
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const authCompleteHandlers = { complete } as const;
