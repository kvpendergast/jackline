type ErrLike = {
  stack?: string;
};

/** Read a stack string from a live Error or Pino's serialized err object. */
export function readErrorStack(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.stack;
  }

  if (err != null && typeof err === "object" && "stack" in err) {
    const stack = (err as ErrLike).stack;
    if (typeof stack === "string" && stack.length > 0) {
      return stack;
    }
  }

  return undefined;
}

/**
 * Promote nested Pino `err.stack` to top-level `stack_trace` for Google Cloud
 * Logging / Error Reporting while keeping Honeycomb-style `err` intact.
 *
 * When `service` is given, also sets `serviceContext.service` so Error
 * Reporting groups errors per service (jackline-api, jackline-gateway, ...)
 * instead of by log name.
 */
export function withGcpStackTrace<T extends Record<string, unknown>>(
  object: T,
  service?: string,
): T & { stack_trace?: string; serviceContext?: { service: string } } {
  const stack = readErrorStack(object["err"]);
  if (!stack) {
    return object;
  }

  return {
    ...object,
    stack_trace: stack,
    ...(service && object["serviceContext"] === undefined
      ? { serviceContext: { service } }
      : {}),
  };
}
