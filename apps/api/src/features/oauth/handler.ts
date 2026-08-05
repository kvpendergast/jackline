import type { RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getConfig } from "@mesh/shared";
import type { MeshEnv } from "../../lib/http/env.js";
import { okEnvelope } from "../../lib/http/envelope.js";
import { oauthCallbackQuerySchema, oauthRoutes } from "./route.js";
import { oauthServices } from "./service.js";

const start: RouteHandler<typeof oauthRoutes.start, MeshEnv> = async (c) => {
  const { auth, log } = c.get("tenantContext");
  const body = c.req.valid("json");
  const result = await oauthServices.startConnect(
    log,
    auth.tenantId,
    auth.userId,
    body.serverId,
  );
  if (result.isErr()) throw result.error;
  return c.json(okEnvelope(result.value), 200);
};

/** GET /api/v1/oauth/callback — public browser redirect (no tenant header). */
export async function oauthCallbackHandler(c: Context<MeshEnv>) {
  const log = c.get("requestContext").log;
  const query = oauthCallbackQuerySchema.parse(c.req.query());
  const config = getConfig();
  const webOrigin = config.isOk()
    ? config.value.WEB_ORIGIN.replace(/\/$/, "")
    : "http://127.0.0.1:5173";

  if (query.error) {
    const msg = query.error_description || query.error;
    return c.redirect(
      `${webOrigin}/my-access?oauth_error=${encodeURIComponent(msg)}`,
    );
  }

  const result = await oauthServices.handleCallback(log, {
    code: query.code,
    state: query.state,
  });

  if (result.isErr()) {
    return c.redirect(
      `${webOrigin}/my-access?oauth_error=${encodeURIComponent(result.error.message)}`,
    );
  }

  return c.redirect(result.value.redirectTo);
}

export const oauthHandlers = {
  start,
} as const;
