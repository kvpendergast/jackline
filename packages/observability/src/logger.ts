import pino, { type DestinationStream, type Logger } from "pino";
import { activeTraceLogFields } from "./traceContext.js";

export type CreateLoggerOptions = {
  logLevel: string;
  nodeEnv: string;
  /** Stable service id on every line (e.g. jackline-api). Maps to jsonPayload.service. */
  service: string;
  /** Optional sink (tests). Defaults to stdout. */
  destination?: DestinationStream;
};

export function createLogger(options: CreateLoggerOptions): Logger {
  const isDev = options.nodeEnv === "development";

  return pino(
    {
      level: options.logLevel,
      base: {
        service: options.service,
      },
      mixin() {
        return activeTraceLogFields();
      },
      ...(isDev
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          }
        : {}),
    },
    options.destination,
  );
}
