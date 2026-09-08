import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { err, ok, type Result } from "neverthrow";
import type { OtelConfig } from "./config.js";
import { ObservabilityError } from "./errors.js";

let sdk: NodeSDK | undefined;
let activeConfig: OtelConfig | undefined;

export function getOtelConfig(): OtelConfig | undefined {
  return activeConfig;
}

export function isOtelExportEnabled(): boolean {
  return activeConfig?.exportEnabled === true;
}

export async function initObservability(
  config: OtelConfig,
): Promise<Result<void, ObservabilityError>> {
  activeConfig = config;

  if (!config.exportEnabled) {
    return ok(undefined);
  }

  if (!config.otlpEndpoint) {
    return err(
      new ObservabilityError(
        "OTEL export is enabled but OTEL_EXPORTER_OTLP_ENDPOINT is missing",
      ),
    );
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: config.otlpEndpoint,
    });

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
      }),
      traceExporter,
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(config.samplerRatio),
      }),
    });

    await sdk.start();
    return ok(undefined);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to initialize OpenTelemetry SDK";
    return err(new ObservabilityError(message));
  }
}

export async function shutdownObservability(): Promise<
  Result<void, ObservabilityError>
> {
  if (!sdk) {
    return ok(undefined);
  }

  try {
    await sdk.shutdown();
    sdk = undefined;
    return ok(undefined);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Failed to shut down OpenTelemetry SDK";
    return err(new ObservabilityError(message));
  }
}

export function getTracer(instrumentationName: string) {
  return trace.getTracer(instrumentationName);
}

export async function withHttpServerSpan<T>(
  otel: OtelConfig,
  input: {
    method: string;
    route: string;
    headers: Headers;
    fn: () => Promise<T>;
  },
): Promise<T> {
  if (!otel.exportEnabled) {
    return input.fn();
  }

  const carrier = headersToSpanCarrier(input.headers);
  const parentContext = propagation.extract(context.active(), carrier);
  const tracer = getTracer("jackline-http");
  const spanName = `${input.method} ${input.route}`;

  return tracer.startActiveSpan(
    spanName,
    {
      attributes: {
        "http.request.method": input.method,
        "url.path": input.route,
      },
    },
    parentContext,
    async (span) => {
      try {
        const result = await input.fn();
        return result;
      } catch (cause) {
        if (cause instanceof Error) {
          span.recordException(cause);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: cause.message,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw cause;
      } finally {
        span.end();
      }
    },
  );
}

/** Active child span for gateway tool calls and similar work units. */
export async function withSpan<T>(
  otel: OtelConfig,
  input: {
    name: string;
    tracerName?: string;
    attributes?: Record<string, string | number | boolean>;
    fn: () => Promise<T>;
  },
): Promise<T> {
  if (!otel.exportEnabled) {
    return input.fn();
  }

  const tracer = getTracer(input.tracerName ?? "jackline");
  return tracer.startActiveSpan(
    input.name,
    input.attributes ? { attributes: input.attributes } : {},
    async (span) => {
      try {
        const result = await input.fn();
        return result;
      } catch (cause) {
        if (cause instanceof Error) {
          span.recordException(cause);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: cause.message,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw cause;
      } finally {
        span.end();
      }
    },
  );
}

function headersToSpanCarrier(headers: Headers): Record<string, string> {
  const carrier: Record<string, string> = {};
  headers.forEach((value, key) => {
    carrier[key.toLowerCase()] = value;
  });
  return carrier;
}
