export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Structured JSON logs so Cloud Logging can read `severity` and `message`. */
export function createLogger(write: (line: string) => void = console.log): Logger {
  const emit = (
    severity: "INFO" | "WARNING" | "ERROR",
    message: string,
    fields?: Record<string, unknown>,
  ): void => {
    write(JSON.stringify({ severity, message, ...fields }));
  };
  return {
    info: (message, fields) => emit("INFO", message, fields),
    warn: (message, fields) => emit("WARNING", message, fields),
    error: (message, fields) => emit("ERROR", message, fields),
  };
}
