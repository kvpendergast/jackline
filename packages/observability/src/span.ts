import { SpanStatusCode, trace } from "@opentelemetry/api";

export function setSpanAttributes(
  attributes: Record<string, string | number | boolean>,
): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}

export function setHttpSpanStatus(status: number): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  span.setAttribute("http.response.status_code", status);
  if (status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
}

export function recordSpanException(error: Error): void {
  const span = trace.getActiveSpan();
  if (!span) return;

  span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });
}
