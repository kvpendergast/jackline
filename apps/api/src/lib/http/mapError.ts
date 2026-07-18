import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ErrorCode, MeshError } from "@mesh/shared";
import { ZodError } from "zod";
import { errEnvelope, formatZodIssues } from "./envelope.js";

export function toHttpStatus(error: MeshError): ContentfulStatusCode {
  switch (error.code) {
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.BAD_REQUEST:
      return 400;
    case ErrorCode.TENANT_LIMIT_REACHED:
      return 409;
    case ErrorCode.NOT_IMPLEMENTED:
      return 501;
    case ErrorCode.INTERNAL:
    default:
      return 500;
  }
}

export function meshOnError(err: Error, c: Context) {
  if (err instanceof MeshError) {
    return c.json(errEnvelope(err.code, err.message), toHttpStatus(err));
  }

  if (err instanceof ZodError) {
    const { message, details } = formatZodIssues(err);
    return c.json(errEnvelope(ErrorCode.BAD_REQUEST, message, details), 400);
  }

  console.error(err);
  return c.json(errEnvelope(ErrorCode.INTERNAL, "Internal error"), 500);
}
