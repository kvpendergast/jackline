export type OutboundEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailConnector = {
  readonly key: string;
  send(message: OutboundEmail): Promise<void>;
};

export type ResolvedEmailConnectorConfig = {
  connectorKey: string;
  fromEmail: string;
  fromName?: string | null;
  apiKey?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
};
