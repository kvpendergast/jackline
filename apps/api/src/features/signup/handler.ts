import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Signup } from "./resource.js";

const status: RouteHandler<typeof Signup.routes.status, JacklineEnv> = async (
  c,
) => {
  const { log } = c.get("requestContext");
  const result = await Signup.services.status(log);
  if (result.isErr()) {
    throw result.error;
  }
  return c.json(okEnvelope(result.value), 200);
};

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

export const signupHandlers = { status, create } as const;
