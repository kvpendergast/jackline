import { ErrorEnvelopeSchema } from "./envelope.js";

/** Shared OpenAPI error responses for tenant-scoped routes. */
export const tenantScopedErrors = {
  400: {
    description: "Validation or missing tenant header",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  401: {
    description: "Not authenticated",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  403: {
    description: "Not a member or insufficient role",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  500: {
    description: "Internal error",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
} as const;

export function notFoundError(description = "Not found") {
  return {
    404: {
      description,
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  } as const;
}
