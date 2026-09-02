import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@jackline/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}
const configResult = loadConfig();

if (configResult.isErr()) throw configResult.error;
const config = configResult.value;

const { serve } = await import("@hono/node-server");
const { initAuth, setVerificationEmailSender } = await import("@jackline/auth");
const { initObservability, shutdownObservability } = await import(
  "@jackline/observability"
);
const { platformEmailServices } = await import(
  "./features/platformEmail/service.js"
);
const { logger, otelConfig } = await import("./lib/observability.js");

const initOtelResult = await initObservability(otelConfig);
if (initOtelResult.isErr()) {
  throw initOtelResult.error;
}

process.on("SIGTERM", () => {
  void shutdownObservability();
});

setVerificationEmailSender(async ({ to, url }) => {
  const result = await platformEmailServices.sendVerification(logger, to, url);
  if (result.isErr()) {
    throw result.error;
  }
});

await initAuth();
const { app } = await import("./app.js");

serve({ fetch: app.fetch, hostname: config.API_HOST, port: config.API_PORT }, () => {
  logger.info(
    { host: config.API_HOST, port: config.API_PORT },
    "api listening",
  );
});
