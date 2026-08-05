import { err, ok, type Result } from "neverthrow";

import { SetupError } from "../errors/index.js";
import { EnvSchema, type Env } from "./schema.js";

const ENV_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "MESH_TENANCY",
  "MESH_MASTER_KEY",
  "MESH_SECRET_STORAGE_LOCATION",
  "DATABASE_URL",
  "API_HOST",
  "API_PORT",
  "GATEWAY_PORT",
  "WEB_ORIGIN",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "MESH_PUBLIC_API_URL",
  "MESH_OIDC_ISSUER",
  "MESH_OIDC_CLIENT_ID",
  "MESH_OIDC_CLIENT_SECRET",
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
  return (env.MESH_PUBLIC_API_URL ?? env.BETTER_AUTH_URL).replace(/\/$/, "");
}

/**
 * Origins allowed for the web UI (CORS + Better Auth trustedOrigins).
 * Expands localhost ↔ 127.0.0.1 so either hostname works in local dev.
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
  return [...origins];
}
