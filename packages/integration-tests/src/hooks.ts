import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@jackline/shared";
import { integrationStack, stopIntegrationStack } from "./helpers/stack.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const envPath = path.join(repoRoot, ".env");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

await integrationStack();

const configResult = loadConfig();
if (configResult.isErr()) {
  throw configResult.error;
}

after(async () => {
  await stopIntegrationStack();
});
