import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
import { baseColumns } from "./columns.js";
import { bytea } from "./bytea.js";

/** Platform-wide outbound email connector (singleton row). */
export const platformEmailSettings = pgTable("platform_email_settings", {
  ...baseColumns,
  connectorKey: text("connector_key").notNull().default("console"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: text("smtp_user"),
  apiKeyCiphertext: bytea("api_key_ciphertext"),
  apiKeyNonce: bytea("api_key_nonce"),
  apiKeyKeyVersion: integer("api_key_key_version"),
});

export type PlatformEmailSettings = typeof platformEmailSettings.$inferSelect;
export type NewPlatformEmailSettings = typeof platformEmailSettings.$inferInsert;
