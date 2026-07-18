import { err, ok, type Result } from "neverthrow";

import { SetupError } from "../errors/index.js";
import { EnvSchema, type Env } from "./schema.js";

const ENV_KEYS = [
  "NODE_ENV",
  "MESH_TENANCY",
  "MESH_MASTER_KEY",
  "DATABASE_URL",
  "API_HOST",
  "API_PORT",
  "GATEWAY_PORT",
  "WEB_ORIGIN",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
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