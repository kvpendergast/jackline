import type { RouteHandler } from "@hono/zod-openapi";
import { okEnvelope } from "../../lib/http/envelope.js";
import { signupRoute } from "./route.js";
import { signupOrg } from "./service.js";

export const signupRouteHandler: RouteHandler<typeof signupRoute> = async (c) => {
  const body = c.req.valid("json");
  const result = await signupOrg(body);

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
