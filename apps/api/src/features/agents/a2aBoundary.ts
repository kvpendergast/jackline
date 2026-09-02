import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorCode, JacklineError } from "@jackline/shared";
import {
  recordSpanException,
  setHttpSpanStatus,
  setSpanAttributes,
} from "@jackline/observability";
import { toHttpStatus } from "../../lib/http/mapError.js";
import type { JacklineEnv } from "../../lib/http/env.js";
import { logger } from "../../lib/logger.js";
import {
  type A2aBoundaryContext,
  a2aErrorLogLevel,
  buildA2aErrorLogFields,
} from "./a2aBoundaryLog.js";

export type { A2aBoundaryContext } from "./a2aBoundaryLog.js";

export function jsonRpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, data },
  };
}

/** Map domain errors to JSON-RPC codes at the A2A wire boundary. */
export function jacklineErrorToJsonRpcCode(error: JacklineError): number {
  switch (error.code) {
    case ErrorCode.NOT_FOUND:
      return -32001;
    case ErrorCode.UNAUTHORIZED:
      return -32000;
    default:
      return -32000;
  }
}

export function jacklineErrorToA2aHttpStatus(error: JacklineError): ContentfulStatusCode {
  if (error.message === "Agent is paused") {
    return 503;
  }
  return toHttpStatus(error);
}

function setA2aSpanAttributes(input: {
  status: number;
  jsonRpcCode: number;
  errorCode: ErrorCode;
  context?: A2aBoundaryContext;
}) {
  setSpanAttributes({
    "jackline.a2a.jsonrpc.error_code": input.jsonRpcCode,
    "jackline.error_code": input.errorCode,
    ...(input.context?.handle
      ? { "jackline.a2a.handle": input.context.handle }
      : {}),
    ...(input.context?.method
      ? { "jackline.a2a.method": input.context.method }
      : {}),
  });
}

function recordA2aBoundaryOutcome(
  c: Context<JacklineEnv>,
  input: {
    status: number;
    message: string;
    jsonRpcCode: number;
    errorCode: ErrorCode;
    error?: JacklineError;
    context?: A2aBoundaryContext;
  },
) {
  const requestContext = c.get("requestContext");
  const log = requestContext?.log ?? logger;
  const level = a2aErrorLogLevel(input.status);

  setA2aSpanAttributes({
    status: input.status,
    jsonRpcCode: input.jsonRpcCode,
    errorCode: input.errorCode,
    ...(input.context ? { context: input.context } : {}),
  });
  setHttpSpanStatus(input.status);

  if (input.status >= 500) {
    recordSpanException(input.error ?? new Error(input.message));
  }

  log[level](
    {
      requestId: requestContext?.requestId,
      ...buildA2aErrorLogFields({
        status: input.status,
        jsonRpcCode: input.jsonRpcCode,
        errorCode: input.errorCode,
        ...(input.context ? { context: input.context } : {}),
      }),
    },
    input.message,
  );
}

export function respondA2aError(
  c: Context<JacklineEnv>,
  id: string | number | null,
  error: JacklineError,
  context?: A2aBoundaryContext,
) {
  const status = jacklineErrorToA2aHttpStatus(error);
  const jsonRpcCode = jacklineErrorToJsonRpcCode(error);
  recordA2aBoundaryOutcome(c, {
    status,
    message: error.message,
    jsonRpcCode,
    errorCode: error.code,
    error,
    ...(context ? { context } : {}),
  });
  return c.json(jsonRpcError(id, jsonRpcCode, error.message), status);
}

export function respondA2aParseError(
  c: Context<JacklineEnv>,
  context?: A2aBoundaryContext,
) {
  const message = "Parse error";
  recordA2aBoundaryOutcome(c, {
    status: 400,
    message,
    jsonRpcCode: -32700,
    errorCode: ErrorCode.BAD_REQUEST,
    ...(context ? { context } : {}),
  });
  return c.json(jsonRpcError(null, -32700, message), 400);
}
