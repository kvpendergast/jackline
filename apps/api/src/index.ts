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
const { initQuotas, shutdownQuotas } = await import("./lib/quotas.js");

const initOtelResult = await initObservability(otelConfig);
if (initOtelResult.isErr()) {
  throw initOtelResult.error;
}

await initQuotas(config.REDIS_URL);

process.on("SIGTERM", () => {
  void shutdownObservability();
  void shutdownQuotas();
});

setVerificationEmailSender(async ({ to, url }) => {
  const result = await platformEmailServices.sendVerification(logger, to, url);
  if (result.isErr()) {
    if (result.error.code === "EMAIL_NOT_CONFIGURED") {
      // Allow Better Auth to continue (e.g. EMAIL_NOT_VERIFIED on sign-in).
      // The verify-email UI loads /platform/email/status and shows a clear error.
      logger.error(
        { to },
        "outbound email is not configured — verification message was not sent",
      );
      return;
    }
    throw result.error;
  }
});

await initAuth();
const { app } = await import("./app.js");

serve({ fetch: app.fetch, hostname: config.API_HOST, port: config.API_PORT }, () => {
  logger.info(
    {
      host: config.API_HOST,
      port: config.API_PORT,
      quotaStore: config.REDIS_URL ? "redis" : "memory",
    },
    "api listening",
  );
});
