export {
  EmailConnectorKeySchema,
  EMAIL_CONNECTOR_KEYS,
  EMAIL_CONNECTOR_PRESETS,
  getEmailConnectorPreset,
  type EmailConnectorKey,
  type EmailConnectorPreset,
} from "@jackline/shared";
export { createConsoleConnector } from "./connectors/console.js";
export { createResendConnector } from "./connectors/resend.js";
export { createSmtpConnector } from "./connectors/smtp.js";
export { createEmailConnector, formatFromAddress } from "./factory.js";
export { verificationEmail } from "./templates/verification.js";
export type {
  EmailConnector,
  OutboundEmail,
  ResolvedEmailConnectorConfig,
} from "./types.js";
