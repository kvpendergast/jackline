import type { OutboundEmail } from "../types.js";

export function verificationEmail(input: {
  from: string;
  to: string;
  url: string;
}): OutboundEmail {
  const text = [
    "Verify your email address to finish signing in to Jackline.",
    "",
    input.url,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  return {
    from: input.from,
    to: input.to,
    subject: "Verify your Jackline email",
    text,
  };
}
