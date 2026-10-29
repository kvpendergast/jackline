import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { PlatformEmail } from "./resource.js";

const getStatus: RouteHandler<
  typeof PlatformEmail.routes.getStatus,
  JacklineEnv
> = async (c) => {
  const { log } = c.get("requestContext");
  const result = await PlatformEmail.services.getStatus(log);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const get: RouteHandler<typeof PlatformEmail.routes.get, JacklineEnv> = async (
  c,
) => {
  const { log } = c.get("requestContext");
  const result = await PlatformEmail.services.get(log);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

const update: RouteHandler<
  typeof PlatformEmail.routes.update,
  JacklineEnv
> = async (c) => {
  const { log } = c.get("requestContext");
  const body = c.req.valid("json");
  const result = await PlatformEmail.services.update(log, body);
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

export const platformEmailHandlers = { getStatus, get, update } as const;
