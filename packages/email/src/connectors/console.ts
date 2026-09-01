import type { EmailConnector, OutboundEmail } from "../types.js";

export function createConsoleConnector(): EmailConnector {
  return {
    key: "console",
    async send(message: OutboundEmail) {
      console.warn(
        `[jackline:email:console] ${message.subject}\n` +
          `from: ${message.from}\n` +
          `to: ${message.to}\n\n` +
          message.text,
      );
    },
  };
}
