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
const { initObservability, shutdownObservability } = await import(
  "@jackline/observability"
);
const { initQuotas, shutdownQuotas } = await import("./lib/quotas.js");
const { logger, otelConfig } = await import("./lib/observability.js");

const initOtelResult = await initObservability(otelConfig);
if (initOtelResult.isErr()) {
  throw initOtelResult.error;
}

await initQuotas(config.REDIS_URL);

process.on("SIGTERM", () => {
  void shutdownObservability();
  void shutdownQuotas();
});

const { app } = await import("./app.js");

serve(
  {
    fetch: app.fetch,
    hostname: config.GATEWAY_HOST,
    port: config.GATEWAY_PORT,
  },
  () => {
    logger.info(
      {
        host: config.GATEWAY_HOST,
        port: config.GATEWAY_PORT,
        quotaStore: config.REDIS_URL ? "redis" : "memory",
      },
      "gateway listening",
    );
  },
);
