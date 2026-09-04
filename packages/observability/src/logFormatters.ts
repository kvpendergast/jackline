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
 */
export function withGcpStackTrace<T extends Record<string, unknown>>(
  object: T,
): T & { stack_trace?: string } {
  const stack = readErrorStack(object["err"]);
  if (!stack) {
    return object;
  }

  return {
    ...object,
    stack_trace: stack,
  };
}
