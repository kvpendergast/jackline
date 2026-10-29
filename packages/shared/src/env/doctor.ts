import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./load.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const envPath = path.join(repoRoot, ".env");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const result = loadConfig();
if (result.isErr()) {
  console.error(result.error.message);
  console.error(
    "\nFix .env (see .env.example), then re-run: pnpm env:check",
  );
  process.exit(1);
}

const env = result.value;
console.log("Jackline environment OK");
console.log(`  tenancy:     ${env.JACKLINE_TENANCY}`);
console.log(`  web origin:  ${env.WEB_ORIGIN}`);
console.log(`  auth URL:    ${env.BETTER_AUTH_URL}`);
console.log(`  api:         ${env.API_HOST}:${env.API_PORT}`);
console.log(`  gateway:     ${env.GATEWAY_HOST}:${env.GATEWAY_PORT}`);
process.exit(0);
