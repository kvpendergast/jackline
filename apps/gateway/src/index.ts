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
const { app } = await import("./app.js");
const { logger } = await import("./lib/logger.js");

const host = "127.0.0.1";

serve({ fetch: app.fetch, hostname: host, port: config.GATEWAY_PORT }, () => {
  logger.info({ host, port: config.GATEWAY_PORT }, "gateway listening");
});
