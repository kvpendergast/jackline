import type { EmailConnector, OutboundEmail } from "../types.js";

type ResendConnectorOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export function createResendConnector(
  options: ResendConnectorOptions,
): EmailConnector {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    key: "resend",
    async send(message: OutboundEmail) {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Resend API failed (${response.status}): ${detail || response.statusText}`,
        );
      }
    },
  };
}
