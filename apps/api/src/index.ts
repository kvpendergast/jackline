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

  // Diagnostic only — never block /health. A slow Google round-trip during
  // rolling deploys previously left the new replica unhealthy before listen.
  const googleClientId = config.GOOGLE_CLIENT_ID;
  const googleClientSecret = config.GOOGLE_CLIENT_SECRET;
  if (googleClientId && googleClientSecret) {
    void (async () => {
      const { probeGoogleCredentials } = await import("@jackline/auth");
      const authBase = config.BETTER_AUTH_URL.replace(/\/$/, "");
      const redirectUri = `${authBase}/api/auth/callback/google`;
      const probe = await probeGoogleCredentials({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri,
      });
      if (probe === "invalid_client") {
        logger.error(
          { redirectUri },
          "GOOGLE_CLIENT_ID/SECRET rejected by Google (invalid_client) — platform Google login will fail with invalid_code until Secret Manager matches the Google Cloud OAuth client",
        );
      } else if (probe === "ok") {
        logger.info(
          { redirectUri },
          "platform Google OAuth client credentials accepted",
        );
      } else {
        logger.warn(
          { redirectUri, probe },
          "could not verify platform Google OAuth credentials",
        );
      }
    })();
  }
});
