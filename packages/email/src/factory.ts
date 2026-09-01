import {
  getEmailConnectorPreset,
} from "@jackline/shared";
import { createConsoleConnector } from "./connectors/console.js";
import { createResendConnector } from "./connectors/resend.js";
import { createSmtpConnector } from "./connectors/smtp.js";
import type { EmailConnector, ResolvedEmailConnectorConfig } from "./types.js";

export function formatFromAddress(
  fromEmail: string,
  fromName?: string | null,
): string {
  const trimmedName = fromName?.trim();
  if (!trimmedName) return fromEmail;
  return `${trimmedName} <${fromEmail}>`;
}

export function createEmailConnector(
  config: ResolvedEmailConnectorConfig,
): EmailConnector {
  const preset = getEmailConnectorPreset(config.connectorKey);

  if (!preset || config.connectorKey === "console") {
    return createConsoleConnector();
  }

  if (config.connectorKey === "resend") {
    if (!config.apiKey) {
      throw new Error("Resend connector requires an API key");
    }
    return createResendConnector({ apiKey: config.apiKey });
  }

  if (config.connectorKey === "smtp") {
    if (!config.smtpHost) {
      throw new Error("SMTP connector requires a host");
    }
    return createSmtpConnector({
      host: config.smtpHost,
      port: config.smtpPort ?? 587,
      secure: config.smtpSecure ?? false,
      user: config.smtpUser ?? null,
      pass: config.smtpPass ?? null,
    });
  }

  return createConsoleConnector();
}
