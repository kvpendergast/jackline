import { createHash } from "node:crypto";

/** SHA-256 hex digest of an opaque token (access tokens, client secrets, etc.). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
