import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EmailConnector } from "../types.js";

type SmtpConnectorOptions = {
  host: string;
  port: number;
  secure: boolean;
  user?: string | null;
  pass?: string | null;
};

export function createSmtpConnector(options: SmtpConnectorOptions): EmailConnector {
  const transporter: Transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    ...(options.user && options.pass
      ? { auth: { user: options.user, pass: options.pass } }
      : {}),
  });

  return {
    key: "smtp",
    async send(message) {
      await transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    },
  };
}
