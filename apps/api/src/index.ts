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

serve({ fetch: app.fetch, hostname: config.API_HOST, port: config.API_PORT }, () => {
  console.log(`api listening on http://${config.API_HOST}:${config.API_PORT}`);
});