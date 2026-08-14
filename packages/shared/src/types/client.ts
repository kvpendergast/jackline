import z from "zod";
import { MembershipRoleSchema } from "./membership.js";

export const ClientKindSchema = z.enum(["interactive", "service"]);

export const PublicClientSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  kind: ClientKindSchema,
  tenantId: z.uuid(),
  /** True when an OAuth2 client_secret has been minted. */
  hasClientSecret: z.boolean(),
  /** Role assumed by client_credentials tokens. */
  apiRole: MembershipRoleSchema,
  apiTeam: z.string().nullable(),
  clientSecretRotatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const MintedClientCredentialsSchema = z.strictObject({
  clientId: z.uuid(),
  clientSecret: z.string().min(1),
  tokenUrl: z.string().url(),
  apiRole: MembershipRoleSchema,
  apiTeam: z.string().nullable(),
});

export const RotateClientCredentialsBodySchema = z.strictObject({
  apiRole: MembershipRoleSchema.optional(),
  apiTeam: z.string().min(1).nullable().optional(),
});

export const OauthTokenResponseSchema = z.strictObject({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
});

export type PublicClient = z.infer<typeof PublicClientSchema>;
export type ClientKind = z.infer<typeof ClientKindSchema>;
export type MintedClientCredentials = z.infer<
  typeof MintedClientCredentialsSchema
>;
export type RotateClientCredentialsBody = z.infer<
  typeof RotateClientCredentialsBodySchema
>;
export type OauthTokenResponse = z.infer<typeof OauthTokenResponseSchema>;

/** OAuth2 access token prefix for Mesh Admin API. */
export const MESH_ACCESS_TOKEN_PREFIX = "mesh_at_" as const;
/** OAuth2 client_secret prefix. */
export const MESH_CLIENT_SECRET_PREFIX = "mesh_cs_" as const;

/** Default access token lifetime (seconds). */
export const MESH_ACCESS_TOKEN_TTL_SECONDS = 3600 as const;

/** Public path for the client_credentials token endpoint. */
export const OAUTH_TOKEN_PATH = "/api/v1/oauth/token" as const;

export function oauthTokenUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, "")}${OAUTH_TOKEN_PATH}`;
}
