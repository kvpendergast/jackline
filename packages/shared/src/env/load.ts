import { err, ok, type Result } from "neverthrow";

import { SetupError } from "../errors/index.js";
import { EnvSchema, type Env } from "./schema.js";

const ENV_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_TRACES_SAMPLER_ARG",
  "JACKLINE_TENANCY",
  "JACKLINE_MASTER_KEY",
  "JACKLINE_SECRET_STORAGE_LOCATION",
  "DATABASE_URL",
  "API_HOST",
  "API_PORT",
  "GATEWAY_HOST",
  "GATEWAY_PORT",
  "WEB_ORIGIN",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "JACKLINE_PUBLIC_API_URL",
  "JACKLINE_PUBLIC_MCP_URL",
  "JACKLINE_INTERNAL_MCP_URL",
  "JACKLINE_ADDITIONAL_ORIGINS",
  "JACKLINE_OIDC_ISSUER",
  "JACKLINE_OIDC_CLIENT_ID",
  "JACKLINE_OIDC_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

let config: Env | undefined;

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): Result<Env, SetupError> {
  const picked = Object.fromEntries(
    ENV_KEYS.map((key) => [key, source[key]]),
  );
  const parsed = EnvSchema.safeParse(picked);
  if (!parsed.success) {
    return err(new SetupError(parsed.error.message));
  }

  config = parsed.data;
  return ok(config);
}

export function getConfig(): Result<Env, SetupError> {
  if (!config) {
    return err(new SetupError('Environment variables not set'))
  }

  return ok(config);
}

/** Browser-reachable API origin (ngrok in local OAuth tests). */
export function publicApiBaseUrl(env: Env): string {
  return (env.JACKLINE_PUBLIC_API_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
}

/** Public MCP endpoint for minted connection credentials. */
export function publicMcpUrl(env: Env): string {
  if (env.JACKLINE_PUBLIC_MCP_URL) {
    return env.JACKLINE_PUBLIC_MCP_URL.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${env.GATEWAY_PORT}/mcp`;
}

/** MCP URL the API uses to call the gateway (Chat agent loop). */
export function internalMcpUrl(env: Env): string {
  if (env.JACKLINE_INTERNAL_MCP_URL) {
    return env.JACKLINE_INTERNAL_MCP_URL.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${env.GATEWAY_PORT}/mcp`;
}

/**
 * Origins allowed for the web UI (CORS + Better Auth trustedOrigins).
 * Expands localhost ↔ 127.0.0.1 so either hostname works in local dev.
 * Also includes JACKLINE_ADDITIONAL_ORIGINS (comma-separated) for split-host setups.
 */
export function webTrustedOrigins(env: Env): string[] {
  const primary = env.WEB_ORIGIN.replace(/\/$/, "");
  const origins = new Set<string>([primary]);
  try {
    const url = new URL(primary);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      origins.add(url.origin);
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      origins.add(url.origin);
    }
  } catch {
    /* keep primary only */
  }
  for (const part of (env.JACKLINE_ADDITIONAL_ORIGINS ?? "").split(",")) {
    const origin = part.trim().replace(/\/$/, "");
    if (!origin) continue;
    try {
      origins.add(new URL(origin).origin);
    } catch {
      origins.add(origin);
    }
  }
  return [...origins];
}
