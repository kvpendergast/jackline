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
const { app } = await import("./app.js");
const { logger } = await import("./lib/logger.js");

serve(
  {
    fetch: app.fetch,
    hostname: config.GATEWAY_HOST,
    port: config.GATEWAY_PORT,
  },
  () => {
    logger.info(
      { host: config.GATEWAY_HOST, port: config.GATEWAY_PORT },
      "gateway listening",
    );
  },
);
