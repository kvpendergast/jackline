import { z } from "zod";

/** Detects whether an OAuth client_id is a CIMD HTTPS metadata URL. */
export function isCimdClientId(clientId: string): boolean {
  const trimmed = clientId.trim();
  if (!trimmed.startsWith("https://")) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Client ID Metadata Document (CIMD) shape.
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document
 */
export const CimdMetadataSchema = z.object({
  client_id: z.string().url(),
  client_name: z.string().min(1).optional(),
  redirect_uris: z.array(z.string().url()).min(1),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  application_type: z.enum(["native", "web"]).optional(),
  scope: z.string().optional(),
});

export type CimdMetadata = z.infer<typeof CimdMetadataSchema>;

/**
 * Validate fetched CIMD JSON against the requested client_id URL.
 * client_id in the document must equal the metadata URL.
 */
export function validateCimdMetadata(
  metadataUrl: string,
  body: unknown,
):
  | { ok: true; metadata: CimdMetadata }
  | { ok: false; error: string } {
  if (!isCimdClientId(metadataUrl)) {
    return { ok: false, error: "client_id must be an https URL" };
  }

  const parsed = CimdMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Invalid client metadata document" };
  }

  const metadata = parsed.data;
  const normalizedDoc = metadata.client_id.replace(/\/$/, "");
  const normalizedUrl = metadataUrl.trim().replace(/\/$/, "");
  if (normalizedDoc !== normalizedUrl) {
    return {
      ok: false,
      error: "client_id in metadata document must match the metadata URL",
    };
  }

  const authMethod = metadata.token_endpoint_auth_method ?? "none";
  if (authMethod !== "none") {
    return {
      ok: false,
      error: "Only token_endpoint_auth_method=none (public clients) is supported",
    };
  }

  return { ok: true, metadata };
}

/**
 * RFC 7591 Dynamic Client Registration request body (subset).
 * Deprecated for new clients — prefer CIMD. Kept for Grok compatibility.
 */
export const DcrRegistrationBodySchema = z
  .object({
    redirect_uris: z.array(z.string().url()).min(1),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    client_name: z.string().min(1).optional(),
    application_type: z.enum(["native", "web"]).optional(),
    scope: z.string().optional(),
    /** Multi-tenancy: tenant slug (also accepted as query `tenant`). */
    tenant: z.string().min(1).optional(),
  })
  .strict();

export type DcrRegistrationBody = z.infer<typeof DcrRegistrationBodySchema>;

export function validateDcrRegistrationBody(
  body: unknown,
):
  | { ok: true; value: DcrRegistrationBody }
  | { ok: false; error: string } {
  const parsed = DcrRegistrationBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid registration request",
    };
  }

  const value = parsed.data;
  const authMethod = value.token_endpoint_auth_method ?? "none";
  if (authMethod !== "none") {
    return {
      ok: false,
      error: "Only token_endpoint_auth_method=none (public clients) is supported",
    };
  }

  const grantTypes = value.grant_types ?? [
    "authorization_code",
    "refresh_token",
  ];
  for (const g of grantTypes) {
    if (g !== "authorization_code" && g !== "refresh_token") {
      return {
        ok: false,
        error: `Unsupported grant_type: ${g}`,
      };
    }
  }

  const responseTypes = value.response_types ?? ["code"];
  for (const r of responseTypes) {
    if (r !== "code") {
      return { ok: false, error: `Unsupported response_type: ${r}` };
    }
  }

  return { ok: true, value };
}
