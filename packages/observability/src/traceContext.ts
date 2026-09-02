import { trace } from "@opentelemetry/api";

export type OtelLogFields = {
  trace_id?: string;
  span_id?: string;
  traceId?: string;
};

/** Extract W3C trace-id from a `traceparent` header value. */
export function parseTraceIdFromTraceparent(
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

/** OTEL-compatible trace fields from the active span, if any. */
export function activeTraceLogFields(): OtelLogFields {
  const span = trace.getActiveSpan();
  if (!span) return {};

  const ctx = span.spanContext();
  if (!ctx.traceId || ctx.traceId === "00000000000000000000000000000000") {
    return {};
  }

  return {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    traceId: ctx.traceId,
  };
}

/** Merge passive traceparent parsing with active span context for log bindings. */
export function resolveTraceLogFields(
  traceparent: string | undefined,
): OtelLogFields {
  const active = activeTraceLogFields();
  if (active.trace_id) {
    return active;
  }

  const traceId = parseTraceIdFromTraceparent(traceparent);
  if (!traceId) return {};

  return {
    trace_id: traceId,
    traceId,
  };
}
