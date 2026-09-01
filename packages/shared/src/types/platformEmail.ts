import z from "zod";

export const EmailConnectorKeySchema = z.enum(["resend", "smtp", "console"]);
export type EmailConnectorKey = z.infer<typeof EmailConnectorKeySchema>;

export const EMAIL_CONNECTOR_KEYS = EmailConnectorKeySchema.options;

export type EmailConnectorPreset = {
  key: EmailConnectorKey;
  name: string;
  description: string;
  requiresApiKey: boolean;
  requiresSmtpHost: boolean;
};

export const EMAIL_CONNECTOR_PRESETS: EmailConnectorPreset[] = [
  {
    key: "resend",
    name: "Resend",
    description: "Transactional email via the Resend HTTP API.",
    requiresApiKey: true,
    requiresSmtpHost: false,
  },
  {
    key: "smtp",
    name: "SMTP",
    description: "Generic SMTP relay (Mailgun, SES SMTP, Mailpit, etc.).",
    requiresApiKey: false,
    requiresSmtpHost: true,
  },
  {
    key: "console",
    name: "Console (dev)",
    description: "Log outbound messages to the API console instead of sending.",
    requiresApiKey: false,
    requiresSmtpHost: false,
  },
];

export function getEmailConnectorPreset(
  key: string,
): EmailConnectorPreset | undefined {
  return EMAIL_CONNECTOR_PRESETS.find((preset) => preset.key === key);
}

export const PLATFORM_EMAIL_API_KEY_AAD = "platform:email:api_key" as const;

export const PublicPlatformEmailSettingsSchema = z.strictObject({
  connectorKey: EmailConnectorKeySchema,
  fromEmail: z.string().nullable(),
  fromName: z.string().nullable(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().positive().nullable(),
  smtpSecure: z.boolean(),
  smtpUser: z.string().nullable(),
  hasApiKey: z.boolean(),
  configured: z.boolean(),
  source: z.enum(["database", "environment", "default"]),
  updatedAt: z.iso.datetime(),
});

export const UpdatePlatformEmailSettingsBodySchema = z.strictObject({
  connectorKey: EmailConnectorKeySchema.optional(),
  fromEmail: z.string().min(1).optional(),
  fromName: z.string().optional(),
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.coerce.number().int().positive().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  apiKey: z.string().min(1).optional(),
  smtpPass: z.string().min(1).optional(),
  clearApiKey: z.boolean().optional(),
});

export type PublicPlatformEmailSettings = z.infer<
  typeof PublicPlatformEmailSettingsSchema
>;
export type UpdatePlatformEmailSettingsBody = z.infer<
  typeof UpdatePlatformEmailSettingsBodySchema
>;
