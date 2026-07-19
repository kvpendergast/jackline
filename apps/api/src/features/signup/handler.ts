import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { Signup } from "./resource.js";

const create: RouteHandler<typeof Signup.routes.create, MeshEnv> = async (c) => {
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

export const signupHandlers = { create } as const;
