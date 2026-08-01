import type { MiddlewareHandler } from "hono";
import { MeshError } from "@mesh/shared";
import { logger } from "../logger.js";
import { resolveConnectionFromAuthorization } from "./resolveConnection.js";
import type { GatewayEnv } from "./types.js";

function errorStatus(error: MeshError): number {
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

  const { connection, tenantId, secretId } = result.value;
  c.set("gatewayContext", {
    requestId,
    connection,
    tenantId,
    secretId,
    log: log.child({
      connectionId: connection.id,
      tenantId,
      clientId: connection.clientId,
      userId: connection.userId,
    }),
  });

  await next();
  return;
};
