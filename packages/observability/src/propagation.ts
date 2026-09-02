import { context, propagation } from "@opentelemetry/api";
import type { OtelConfig } from "./config.js";

export type OutboundTraceHeaders = Record<string, string>;

/** Inject W3C trace context and Jackline correlation headers for outbound calls. */
export function injectOutboundHeaders(
  otel: OtelConfig,
  input: {
    requestId?: string | undefined;
    headers?: OutboundTraceHeaders | undefined;
  },
): OutboundTraceHeaders {
  const headers: OutboundTraceHeaders = { ...(input.headers ?? {}) };

  if (input.requestId) {
    headers["X-Request-Id"] = input.requestId;
  }

  if (otel.exportEnabled) {
    propagation.inject(context.active(), headers);
  }

  return headers;
}

/** Build a header carrier from an incoming Fetch/Hono request. */
export function headersToCarrier(
  headers: Headers | Record<string, string | undefined>,
): Record<string, string> {
  const carrier: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      carrier[key.toLowerCase()] = value;
    });
    return carrier;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value != null) {
      carrier[key.toLowerCase()] = value;
    }
  }

  return carrier;
}
