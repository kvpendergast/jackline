import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireSession } from "../../lib/request/index.js";
import { Signup } from "./resource.js";

const create: RouteHandler<typeof Signup.routes.create, JacklineEnv> = async (c) => {
  const { log } = c.get("requestContext");
  const body = c.req.valid("json");
  const result = await Signup.services.create(log, body);

  if (result.isErr()) {
    throw result.error;
  }

  const { user, tenant, membership, authResponse } = result.value;

  authResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      c.header(key, value, { append: true });
    }
  });

  return c.json(okEnvelope({ user, tenant, membership }), 201);
};

const createSocial: RouteHandler<
  typeof Signup.routes.createSocial,
  JacklineEnv
> = async (c) => {
  const sessionResult = await requireSession(c);
  if (sessionResult.isErr()) {
    throw sessionResult.error;
  }

  const { ctx, user } = sessionResult.value;
  const body = c.req.valid("json");
  const result = await Signup.services.createSocial(
    ctx.log,
    user,
    body.organizationName,
  );
  if (result.isErr()) {
    throw result.error;
  }

  const { user: u, tenant, membership } = result.value;
  return c.json(okEnvelope({ user: u, tenant, membership }), 201);
};

export const signupHandlers = { create, createSocial } as const;
