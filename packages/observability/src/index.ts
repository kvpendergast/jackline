export { ObservabilityError } from "./errors.js";
export {
  resolveOtelConfig,
  otelConfigFromEnv,
  type OtelConfig,
  type ResolveOtelConfigInput,
} from "./config.js";
export { createLogger, type CreateLoggerOptions } from "./logger.js";
export {
  initObservability,
  shutdownObservability,
  getOtelConfig,
  isOtelExportEnabled,
  getTracer,
  withHttpServerSpan,
  withSpan,
} from "./init.js";
export {
  parseTraceIdFromTraceparent,
  activeTraceLogFields,
  resolveTraceLogFields,
  type OtelLogFields,
} from "./traceContext.js";
export {
  injectOutboundHeaders,
  headersToCarrier,
  type OutboundTraceHeaders,
} from "./propagation.js";
export { setHttpSpanStatus, recordSpanException, setSpanAttributes } from "./span.js";
export {
  createHttpObservabilityMiddleware,
  type HttpRequestContext,
  type HttpObservabilityEnv,
  type CreateHttpObservabilityMiddlewareOptions,
} from "./middleware/httpObservability.js";
