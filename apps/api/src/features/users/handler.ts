import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { User } from "./resource.js";

function actorFrom(auth: JacklineEnv["Variables"]["tenantContext"]["auth"]) {
  return {
    userId: auth.userId,
    role: auth.membership.role,
    team: auth.membership.team,
  };
}

const list: RouteHandler<typeof User.routes.list, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const query = c.req.valid("query");
  const result = await User.services.list(
    log,
    auth.tenantId,
    actorFrom(auth),
    query,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

const create: RouteHandler<typeof User.routes.create, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await User.services.createService(log, auth.tenantId, {
    name: body.name,
    email: body.email,
  });
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 201);
};

const get: RouteHandler<typeof User.routes.get, JacklineEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const { id } = c.req.valid("param");
  const result = await User.services.get(
    log,
    auth.tenantId,
    actorFrom(auth),
    id,
  );
  if (result.isErr()) {
    throw result.error;
  }

  return c.json(okEnvelope(result.value), 200);
};

export const userHandlers = {
  list,
  create,
  get,
} as const;
