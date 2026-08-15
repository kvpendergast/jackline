import type { MiddlewareHandler } from "hono";
import { logger } from "../logger.js";
import { parseTraceId } from "./traceparent.js";
import type { AnonymousRequestContext } from "./types.js";
import type { JacklineEnv } from "../http/env.js";

export const requestMiddleware: MiddlewareHandler<JacklineEnv> = async (c, next) => {
  const started = Date.now();
  const inboundId = c.req.header("X-Request-Id")?.trim();
  const requestId =
    inboundId && inboundId.length > 0 ? inboundId : crypto.randomUUID();
  const traceId = parseTraceId(c.req.header("traceparent"));

  const log = logger.child({
    requestId,
    ...(traceId ? { traceId } : {}),
    route: c.req.path,
    method: c.req.method,
  });

  const requestContext: AnonymousRequestContext = {
    requestId,
    ...(traceId ? { traceId } : {}),
    log,
  };

  c.set("requestContext", requestContext);
  c.header("X-Request-Id", requestId);

  await next();

  log.info(
    {
      status: c.res.status,
      durationMs: Date.now() - started,
    },
    "request completed",
  );
};
