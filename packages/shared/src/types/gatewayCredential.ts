import { err, ok, type Result } from "neverthrow";
import z from "zod";

import { BadRequestError } from "../errors/index.js";

export const GATEWAY_TOKEN_KIND = "gateway_token" as const;
export const GATEWAY_TOKEN_PREFIX = "jkl_" as const;

/** Presented once at mint: `jkl_<secretId>.<secret>`. */
export function formatGatewayToken(secretId: string, secret: string): string {
  return `${GATEWAY_TOKEN_PREFIX}${secretId}.${secret}`;
}

export type ParsedGatewayToken = {
  secretId: string;
  secret: string;
};

/** Parse `jkl_<secretId>.<secret>` from a bearer credential. */
export function parseGatewayToken(
  token: string,
): Result<ParsedGatewayToken, BadRequestError> {
  const trimmed = token.trim();
  if (!trimmed.startsWith(GATEWAY_TOKEN_PREFIX)) {
    return err(new BadRequestError("Invalid gateway token format"));
  }

  const rest = trimmed.slice(GATEWAY_TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) {
    return err(new BadRequestError("Invalid gateway token format"));
  }

  const secretId = rest.slice(0, dot);
  const secret = rest.slice(dot + 1);
  const idParsed = z.uuid().safeParse(secretId);
  if (!idParsed.success || secret.length === 0) {
    return err(new BadRequestError("Invalid gateway token format"));
  }

  return ok({ secretId, secret });
}

export const PublicGatewayCredentialSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal(GATEWAY_TOKEN_KIND),
  name: z.string(),
  connectionId: z.uuid(),
  tenantId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const MintedGatewayCredentialSchema = PublicGatewayCredentialSchema.extend(
  {
    token: z.string(),
    mcp: z.strictObject({
      url: z.string(),
      headers: z.strictObject({
        Authorization: z.string(),
      }),
    }),
  },
);

export type PublicGatewayCredential = z.infer<
  typeof PublicGatewayCredentialSchema
>;
export type MintedGatewayCredential = z.infer<
  typeof MintedGatewayCredentialSchema
>;
