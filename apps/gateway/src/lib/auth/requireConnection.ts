import type { MiddlewareHandler } from "hono";
import {
  JacklineError,
  getConfig,
  mcpOauthWwwAuthenticate,
  publicMcpUrl,
} from "@jackline/shared";
import { logger } from "../logger.js";
import { resolveConnectionFromAuthorization } from "./resolveConnection.js";
import type { GatewayEnv } from "./types.js";

function errorStatus(error: JacklineError): number {
  switch (error.code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "BAD_REQUEST":
      return 400;
    default:
      return 500;
  }
}

function wwwAuthenticateHeader(): string | undefined {
  const config = getConfig();
  if (config.isErr()) return undefined;
  try {
    return mcpOauthWwwAuthenticate(publicMcpUrl(config.value));
  } catch {
    return undefined;
  }
}

export const requireConnection: MiddlewareHandler<GatewayEnv> = async (
  c,
  next,
) => {
  const requestId =
    c.req.header("X-Request-Id")?.trim() || crypto.randomUUID();
  c.header("X-Request-Id", requestId);

  const log = logger.child({
    requestId,
    route: c.req.path,
    method: c.req.method,
  });

  const result = await resolveConnectionFromAuthorization(
    c.req.header("Authorization"),
    log,
  );

  if (result.isErr()) {
    const error = result.error;
    const status = errorStatus(error);
    if (status >= 500) {
      log.error({ err: error }, "gateway auth failed");
    }
    if (status === 401) {
      const challenge = wwwAuthenticateHeader();
      if (challenge) c.header("WWW-Authenticate", challenge);
    }
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      status as 401 | 403 | 400 | 500,
    );
  }

  const { connection, tenantId, auth } = result.value;
  c.set("gatewayContext", {
    requestId,
    connection,
    tenantId,
    secretId: auth.kind === "gateway_token" ? auth.secretId : null,
    mcpOAuthAccessTokenId:
      auth.kind === "mcp_oauth" ? auth.accessTokenId : null,
    mcpOAuthClientId: auth.kind === "mcp_oauth" ? auth.mcpClientId : null,
    authKind: auth.kind,
    log: log.child({
      connectionId: connection.id,
      tenantId,
      clientId: connection.clientId,
      userId: connection.userId,
      authKind: auth.kind,
    }),
  });

  await next();
  return;
};
