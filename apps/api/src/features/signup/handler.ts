import type { RouteHandler } from "@hono/zod-openapi";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { signupRoute } from "./route.js";
import { signupOrg } from "./service.js";

export const signupRouteHandler: RouteHandler<typeof signupRoute, MeshEnv> = async (c) => {
  const { log } = c.get("requestContext");
  const body = c.req.valid("json");
  const result = await signupOrg(log, body);

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
