import type { RouteHandler } from "@hono/zod-openapi";
import type { JacklineEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { requireSession } from "../../lib/request/index.js";
import { resolveBearerAuth } from "../../lib/request/requireTenantContext.js";
import { Me } from "./resource.js";

function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

const get: RouteHandler<typeof Me.routes.get, JacklineEnv> = async (c) => {
  const bearer = extractBearer(c.req.header("Authorization"));
  if (bearer) {
    // OAuth bearer (e.g. `jackline login` user token): tenant-bound context.
    const log = c.get("requestContext").log;
    const authResult = await resolveBearerAuth(c, bearer);
    if (authResult.isErr()) throw authResult.error;
    const userResult = await Me.services.loadPublicUser(authResult.value.userId);
    if (userResult.isErr()) throw userResult.error;
    const result = await Me.services.get(
      log,
      userResult.value,
      authResult.value,
    );
    if (result.isErr()) throw result.error;
    return c.json(okEnvelope(result.value), 200);
  }

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
