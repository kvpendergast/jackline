import { z } from "@hono/zod-openapi";
import type { ZodError } from "zod";

export const ApiErrorBodySchema = z
  .strictObject({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  })
  .openapi("ApiErrorBody");

export const ErrorEnvelopeSchema = z
  .strictObject({
    success: z.literal(false),
    error: ApiErrorBodySchema,
  })
  .openapi("ErrorEnvelope");

export function successEnvelopeSchema<T extends z.ZodType>(
  dataSchema: T,
  name: string,
) {
  return z
    .strictObject({
      success: z.literal(true),
      data: dataSchema,
    })
    .openapi(name);
}

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export type SuccessEnvelope<T> = {
  success: true;
  data: T;
};

export function okEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}

export function errEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

export function formatZodIssues(error: ZodError): {
  message: string;
  details: Array<{ path: Array<string | number>; message: string }>;
} {
  const details = error.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
    message: issue.message,
  }));

  const message =
    details.length === 0
      ? "Validation failed"
      : details
          .map((d) => {
            const path = d.path.length > 0 ? d.path.join(".") : "(root)";
            return `${path}: ${d.message}`;
          })
          .join("; ");

  return { message, details };
}
