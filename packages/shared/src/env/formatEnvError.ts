import type { ZodError } from "zod";

const HINTS: Record<string, string> = {
  JACKLINE_MASTER_KEY: "generate with: openssl rand -base64 32",
  BETTER_AUTH_SECRET: "generate with: openssl rand -base64 32",
  DATABASE_URL:
    "set DATABASE_URL, or POSTGRES_USER + POSTGRES_DB (+ POSTGRES_PASSWORD/HOST/PORT)",
  BETTER_AUTH_URL: "URL where /api/auth is served (e.g. http://127.0.0.1:8080)",
  WEB_ORIGIN: "admin UI origin (e.g. http://127.0.0.1:5173)",
};

/** Human-readable multi-line message for failed EnvSchema parses. */
export function formatEnvParseError(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    const hint = HINTS[path];
    return hint
      ? `  - ${path}: ${issue.message} (${hint})`
      : `  - ${path}: ${issue.message}`;
  });

  return [
    "Invalid Jackline environment configuration:",
    ...lines,
    "See .env.example and apps/docs (Self-hosting).",
  ].join("\n");
}
