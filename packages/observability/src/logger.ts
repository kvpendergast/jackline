import pino, { type Logger } from "pino";
import { activeTraceLogFields } from "./traceContext.js";

export type CreateLoggerOptions = {
  logLevel: string;
  nodeEnv: string;
};

export function createLogger(options: CreateLoggerOptions): Logger {
  const isDev = options.nodeEnv === "development";

  return pino({
    level: options.logLevel,
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
  });
}
