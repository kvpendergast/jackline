import pino, { type Logger } from "pino";
import { withGcpStackTrace } from "./logFormatters.js";
import { activeTraceLogFields } from "./traceContext.js";

export type CreateLoggerOptions = {
  logLevel: string;
  nodeEnv: string;
};

export function createLogger(options: CreateLoggerOptions): Logger {
  const isDev = options.nodeEnv === "development";

  return pino({
    level: options.logLevel,
    serializers: {
      err: pino.stdSerializers.err,
    },
    formatters: {
      log(object) {
        return withGcpStackTrace(object);
      },
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
  });
}
