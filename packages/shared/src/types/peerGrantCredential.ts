import { err, ok, type Result } from "neverthrow";
import z from "zod";

import { BadRequestError } from "../errors/index.js";

export const PEER_GRANT_TOKEN_KIND = "peer_grant_token" as const;
export const PEER_GRANT_TOKEN_PREFIX = "jka_" as const;

/** Presented once at mint: `jka_<secretId>.<secret>`. */
export function formatPeerGrantToken(secretId: string, secret: string): string {
  return `${PEER_GRANT_TOKEN_PREFIX}${secretId}.${secret}`;
}

export type ParsedPeerGrantToken = {
  secretId: string;
  secret: string;
};

/** Parse `jka_<secretId>.<secret>` from a bearer credential. */
export function parsePeerGrantToken(
  token: string,
): Result<ParsedPeerGrantToken, BadRequestError> {
  const trimmed = token.trim();
  if (!trimmed.startsWith(PEER_GRANT_TOKEN_PREFIX)) {
    return err(new BadRequestError("Invalid peer grant token format"));
  }

  const rest = trimmed.slice(PEER_GRANT_TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) {
    return err(new BadRequestError("Invalid peer grant token format"));
  }

  const secretId = rest.slice(0, dot);
  const secret = rest.slice(dot + 1);
  const idParsed = z.uuid().safeParse(secretId);
  if (!idParsed.success || secret.length === 0) {
    return err(new BadRequestError("Invalid peer grant token format"));
  }

  return ok({ secretId, secret });
}

export function extractBearerToken(
  authorization: string | undefined,
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}
