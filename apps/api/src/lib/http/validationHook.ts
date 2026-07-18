import type { Hook } from "@hono/zod-openapi";
import { ErrorCode } from "@mesh/shared";
import { errEnvelope, formatZodIssues } from "./envelope.js";

/** OpenAPIHono defaultHook — maps Zod validation failures to the Mesh error envelope. */
export const validationHook: Hook<unknown, any, any, Response | void> = (
  result,
  c,
) => {
  if (result.success) {
    return;
  }

  const { message, details } = formatZodIssues(result.error);
  return c.json(errEnvelope(ErrorCode.BAD_REQUEST, message, details), 400);
};
