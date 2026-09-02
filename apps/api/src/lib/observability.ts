import { getConfig } from "@jackline/shared";
import type { Logger } from "pino";
import {
  createHttpObservabilityMiddleware,
  createLogger,
  otelConfigFromEnv,
} from "@jackline/observability";
import type { JacklineEnv } from "./http/env.js";

const configResult = getConfig();
if (configResult.isErr()) {
  throw configResult.error;
}
const config = configResult.value;

const otelConfigResult = otelConfigFromEnv(config, "jackline-api");
if (otelConfigResult.isErr()) {
  throw otelConfigResult.error;
}

export const otelConfig = otelConfigResult.value;

export const logger: Logger = createLogger({
  logLevel: config.LOG_LEVEL,
  nodeEnv: config.NODE_ENV,
});

export const requestMiddleware = createHttpObservabilityMiddleware<JacklineEnv>({
  otel: otelConfig,
  logger,
});
