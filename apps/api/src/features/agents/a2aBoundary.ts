import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorCode, JacklineError } from "@jackline/shared";
import { toHttpStatus } from "../../lib/http/mapError.js";
import type { JacklineEnv } from "../../lib/http/env.js";

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

export function respondA2aError(
  c: Context<JacklineEnv>,
  id: string | number | null,
  error: JacklineError,
) {
  const status = jacklineErrorToA2aHttpStatus(error);
  return c.json(
    jsonRpcError(id, jacklineErrorToJsonRpcCode(error), error.message),
    status,
  );
}
