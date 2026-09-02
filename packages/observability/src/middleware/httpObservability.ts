import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { OtelConfig } from "../config.js";
import { withHttpServerSpan } from "../init.js";
import { setHttpSpanStatus } from "../span.js";
import { resolveTraceLogFields } from "../traceContext.js";

export type HttpRequestContext = {
  requestId: string;
  traceId?: string;
  log: Logger;
};

export type HttpObservabilityEnv = {
  Variables: {
    requestContext: HttpRequestContext;
  };
};

export type CreateHttpObservabilityMiddlewareOptions = {
  otel: OtelConfig;
  logger: Logger;
};

function resolveRequestId(inboundId: string | undefined): string {
  const trimmed = inboundId?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  return crypto.randomUUID();
}

export function createHttpObservabilityMiddleware<
  E extends HttpObservabilityEnv = HttpObservabilityEnv,
>(
  options: CreateHttpObservabilityMiddlewareOptions,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const started = Date.now();
    const requestId = resolveRequestId(c.req.header("X-Request-Id"));
    const traceparent = c.req.header("traceparent");
    const traceFields = resolveTraceLogFields(traceparent);

    const log = options.logger.child({
      requestId,
      ...(traceFields.traceId ? { traceId: traceFields.traceId } : {}),
      ...(traceFields.trace_id ? { trace_id: traceFields.trace_id } : {}),
      ...(traceFields.span_id ? { span_id: traceFields.span_id } : {}),
      route: c.req.path,
      method: c.req.method,
    });

    const requestContext: HttpRequestContext = {
      requestId,
      ...(traceFields.traceId ? { traceId: traceFields.traceId } : {}),
      log,
    };

    c.set("requestContext", requestContext);
    c.header("X-Request-Id", requestId);

    await withHttpServerSpan(options.otel, {
      method: c.req.method,
      route: c.req.path,
      headers: c.req.raw.headers,
      fn: async () => {
        await next();
        setHttpSpanStatus(c.res.status);
      },
    });

    log.info(
      {
        status: c.res.status,
        durationMs: Date.now() - started,
      },
      "request completed",
    );
  };
}
