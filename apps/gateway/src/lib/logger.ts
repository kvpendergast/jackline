import pino from "pino";
import { getConfig } from "@jackline/shared";

function createRootLogger() {
  const configResult = getConfig();
  const level = configResult.isOk() ? configResult.value.LOG_LEVEL : "info";
  const isDev =
    configResult.isOk() && configResult.value.NODE_ENV === "development";

  return pino({
    level,
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

export const logger = createRootLogger();
