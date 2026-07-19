/** Extract W3C trace-id from a `traceparent` header value. */
export function parseTraceId(
  traceparent: string | undefined,
): string | undefined {
  if (!traceparent) return undefined;

  const parts = traceparent.split("-");
  if (parts.length < 4) return undefined;

  const traceId = parts[1];
  if (!traceId || traceId.length !== 32 || /^0+$/.test(traceId)) {
    return undefined;
  }

  return traceId;
}
