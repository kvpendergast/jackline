import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@mesh/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvFile(path.join(root, ".env"));
const configResult = loadConfig();

if (configResult.isErr()) throw configResult.error;
const config = configResult.value;

const { serve } = await import("@hono/node-server");
const { initAuth } = await import("@mesh/auth");
await initAuth();
const { app } = await import("./app.js");
const { logger } = await import("./lib/logger.js");

serve({ fetch: app.fetch, hostname: config.API_HOST, port: config.API_PORT }, () => {
  logger.info(
    { host: config.API_HOST, port: config.API_PORT },
    "api listening",
  );
});
