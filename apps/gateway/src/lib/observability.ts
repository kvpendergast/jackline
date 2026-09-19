import { getConfig } from "@jackline/shared";
import type { Logger } from "pino";
import {
  createHttpObservabilityMiddleware,
  createLogger,
  otelConfigFromEnv,
} from "@jackline/observability";
import type { GatewayEnv } from "./auth/types.js";

const configResult = getConfig();
if (configResult.isErr()) {
  throw configResult.error;
}
const config = configResult.value;

const otelConfigResult = otelConfigFromEnv(config, "jackline-gateway");
if (otelConfigResult.isErr()) {
  throw otelConfigResult.error;
}

export const otelConfig = otelConfigResult.value;

export const logger: Logger = createLogger({
  logLevel: config.LOG_LEVEL,
  nodeEnv: config.NODE_ENV,
  service: "jackline-gateway",
});

export const requestMiddleware = createHttpObservabilityMiddleware<GatewayEnv>({
  otel: otelConfig,
  logger,
});
