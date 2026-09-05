import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorCode, JacklineError, RateLimitedError } from "@jackline/shared";
import { recordSpanException, setHttpSpanStatus } from "@jackline/observability";
import { ZodError } from "zod";
import { errEnvelope, formatZodIssues } from "./envelope.js";
import type { JacklineEnv } from "./env.js";
import { logger } from "../logger.js";

export function toHttpStatus(error: JacklineError): ContentfulStatusCode {
  switch (error.code) {
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.EMAIL_NOT_VERIFIED:
      return 403;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.BAD_REQUEST:
      return 400;
    case ErrorCode.RATE_LIMITED:
      return 429;
    case ErrorCode.TENANT_LIMIT_REACHED:
      return 409;
    case ErrorCode.NOT_IMPLEMENTED:
      return 501;
    case ErrorCode.INTERNAL:
    default:
      return 500;
  }
}

export function jacklineOnError(err: Error, c: Context<JacklineEnv>) {
  const ctx = c.get("requestContext");
  const log = ctx?.log ?? logger;
  const requestId = ctx?.requestId ?? c.res.headers.get("X-Request-Id");

  if (err instanceof JacklineError) {
    const status = toHttpStatus(err);
    const level = status >= 500 ? "error" : "warn";
    if (status >= 500) {
      recordSpanException(err);
    }
    setHttpSpanStatus(status);
    if (err instanceof RateLimitedError) {
      c.header("Retry-After", String(err.retryAfterSeconds));
    }
    log[level](
      {
        requestId,
        errorCode: err.code,
        status,
        ...(err instanceof RateLimitedError
          ? { retryAfterSeconds: err.retryAfterSeconds }
          : {}),
      },
      err.message,
    );
    return c.json(errEnvelope(err.code, err.message), status);
  }

  if (err instanceof ZodError) {
    const { message, details } = formatZodIssues(err);
    setHttpSpanStatus(400);
    log.warn(
      {
        requestId,
        errorCode: ErrorCode.BAD_REQUEST,
        status: 400,
      },
      message,
    );
    return c.json(errEnvelope(ErrorCode.BAD_REQUEST, message, details), 400);
  }

  recordSpanException(err);
  setHttpSpanStatus(500);
  log.error(
    {
      requestId,
      errorCode: ErrorCode.INTERNAL,
      status: 500,
      err,
    },
    "unhandled error",
  );
  return c.json(errEnvelope(ErrorCode.INTERNAL, "Internal error"), 500);
}
