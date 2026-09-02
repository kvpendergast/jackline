import type { MiddlewareHandler } from "hono";
import { JacklineError } from "@jackline/shared";
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

export const requireConnection: MiddlewareHandler<GatewayEnv> = async (
  c,
  next,
) => {
  const base = c.get("requestContext");
  const requestId = base.requestId;
  const log = base.log;

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
