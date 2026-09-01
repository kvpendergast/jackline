import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Env } from "@jackline/shared";

export type VerificationEmailInput = {
  to: string;
  url: string;
};

export type Mailer = {
  sendVerificationEmail: (input: VerificationEmailInput) => Promise<void>;
};

function smtpConfigured(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.EMAIL_FROM);
}

export function createMailer(env: Env): Mailer {
  let transporter: Transporter | null = null;
  if (smtpConfigured(env)) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    });
  }

  return {
    async sendVerificationEmail({ to, url }) {
      const subject = "Verify your Jackline email";
      const text = [
        "Verify your email address to finish signing in to Jackline.",
        "",
        url,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n");

      if (!transporter) {
        console.warn(
          `[jackline] SMTP not configured — verification link for ${to}:\n${url}`,
        );
        return;
      }

      await transporter.sendMail({
        from: env.EMAIL_FROM,
        to,
        subject,
        text,
      });
    },
  };
}
