import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { BadRequestError, MeshError } from "../errors/index.js";

/**
 * Upstream OAuth secret plaintext (encrypted at rest as the secret `value`).
 *
 * Formats:
 * 1. Raw access token string → Bearer token
 * 2. JSON access token: `{ "accessToken": "..." }`
 * 3. Refreshable token: `{ "accessToken"?, "refreshToken", "tokenUrl", "clientId"?, "clientSecret"? }`
 * 4. Client credentials: `{ "clientId", "clientSecret", "tokenUrl", "scopes"? }`
 */
export const UpstreamOAuthSecretSchema = z.union([
  z.strictObject({
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    tokenUrl: z.url().optional(),
    scopes: z.string().min(1).optional(),
    expiresAt: z.number().int().positive().optional(),
  }),
  z.string().min(1),
]);

export type UpstreamOAuthSecret = z.infer<typeof UpstreamOAuthSecretSchema>;

export type ResolvedUpstreamBearer = {
  accessToken: string;
  /** When known, unix ms; used for short-lived caches. */
  expiresAt?: number | undefined;
};

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
});

export function parseUpstreamOAuthSecret(
  plaintext: string,
): Result<UpstreamOAuthSecret, MeshError> {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    return err(new BadRequestError("OAuth secret value is empty"));
  }

  if (trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return err(new BadRequestError("OAuth secret value is not valid JSON"));
    }
    const parsed = UpstreamOAuthSecretSchema.safeParse(json);
    if (!parsed.success) {
      return err(
        new BadRequestError(
          "OAuth secret JSON must include accessToken and/or clientId+clientSecret+tokenUrl",
        ),
      );
    }
    return ok(parsed.data);
  }

  return ok(trimmed);
}

function isFresh(expiresAt: number | undefined, skewMs = 30_000): boolean {
  if (expiresAt == null) return true;
  return Date.now() + skewMs < expiresAt;
}

async function tokenRequest(
  tokenUrl: string,
  body: URLSearchParams,
  basic?: { clientId: string; clientSecret: string },
): Promise<Result<z.infer<typeof TokenResponseSchema>, MeshError>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (basic) {
    const raw = `${basic.clientId}:${basic.clientSecret}`;
    const bytes = new TextEncoder().encode(raw);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    headers["Authorization"] = `Basic ${btoa(binary)}`;
  }

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "network error";
    return err(new MeshError("INTERNAL", `OAuth token request failed: ${detail}`));
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return err(
      new MeshError(
        "INTERNAL",
        `OAuth token endpoint returned non-JSON (${res.status})`,
      ),
    );
  }

  if (!res.ok) {
    const message =
      json &&
      typeof json === "object" &&
      "error_description" in json &&
      typeof (json as { error_description: unknown }).error_description ===
        "string"
        ? (json as { error_description: string }).error_description
        : text.slice(0, 200) || res.statusText;
    return err(
      new MeshError(
        "INTERNAL",
        `OAuth token endpoint → ${res.status}: ${message}`,
      ),
    );
  }

  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      new MeshError(
        "INTERNAL",
        "OAuth token endpoint response missing access_token",
      ),
    );
  }

  return ok(parsed.data);
}

/**
 * Resolve a bearer access token from an OAuth secret plaintext.
 * Performs client_credentials or refresh_token grants when needed.
 */
export async function resolveOAuthAccessToken(
  plaintext: string,
): Promise<Result<ResolvedUpstreamBearer, MeshError>> {
  const parsed = parseUpstreamOAuthSecret(plaintext);
  if (parsed.isErr()) return err(parsed.error);

  const secret = parsed.value;
  if (typeof secret === "string") {
    return ok({ accessToken: secret });
  }

  if (secret.accessToken && isFresh(secret.expiresAt)) {
    return ok({
      accessToken: secret.accessToken,
      expiresAt: secret.expiresAt,
    });
  }

  if (secret.refreshToken && secret.tokenUrl) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: secret.refreshToken,
    });
    if (secret.scopes) body.set("scope", secret.scopes);
    if (secret.clientId && !secret.clientSecret) {
      body.set("client_id", secret.clientId);
    }

    const basic =
      secret.clientId && secret.clientSecret
        ? { clientId: secret.clientId, clientSecret: secret.clientSecret }
        : undefined;

    const token = await tokenRequest(secret.tokenUrl, body, basic);
    if (token.isErr()) return err(token.error);

    return ok({
      accessToken: token.value.access_token,
      expiresAt: token.value.expires_in
        ? Date.now() + token.value.expires_in * 1000
        : undefined,
    });
  }

  if (secret.clientId && secret.clientSecret && secret.tokenUrl) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
    });
    if (secret.scopes) body.set("scope", secret.scopes);

    const token = await tokenRequest(secret.tokenUrl, body, {
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
    });
    if (token.isErr()) return err(token.error);

    return ok({
      accessToken: token.value.access_token,
      expiresAt: token.value.expires_in
        ? Date.now() + token.value.expires_in * 1000
        : undefined,
    });
  }

  if (secret.accessToken) {
    return ok({
      accessToken: secret.accessToken,
      expiresAt: secret.expiresAt,
    });
  }

  return err(
    new BadRequestError(
      "OAuth secret needs accessToken, or refreshToken+tokenUrl, or clientId+clientSecret+tokenUrl",
    ),
  );
}

/** Build the JSON string stored as the encrypted secret value for OAuth. */
export function encodeOAuthSecretValue(input: {
  mode: "access_token" | "client_credentials" | "refreshable";
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string;
}): Result<string, MeshError> {
  if (input.mode === "access_token") {
    if (!input.accessToken?.trim()) {
      return err(new BadRequestError("Access token is required"));
    }
    return ok(input.accessToken.trim());
  }

  if (input.mode === "client_credentials") {
    if (!input.clientId?.trim() || !input.clientSecret?.trim() || !input.tokenUrl?.trim()) {
      return err(
        new BadRequestError("clientId, clientSecret, and tokenUrl are required"),
      );
    }
    return ok(
      JSON.stringify({
        clientId: input.clientId.trim(),
        clientSecret: input.clientSecret.trim(),
        tokenUrl: input.tokenUrl.trim(),
        ...(input.scopes?.trim() ? { scopes: input.scopes.trim() } : {}),
      }),
    );
  }

  if (!input.refreshToken?.trim() || !input.tokenUrl?.trim()) {
    return err(new BadRequestError("refreshToken and tokenUrl are required"));
  }

  return ok(
    JSON.stringify({
      ...(input.accessToken?.trim()
        ? { accessToken: input.accessToken.trim() }
        : {}),
      refreshToken: input.refreshToken.trim(),
      tokenUrl: input.tokenUrl.trim(),
      ...(input.clientId?.trim() ? { clientId: input.clientId.trim() } : {}),
      ...(input.clientSecret?.trim()
        ? { clientSecret: input.clientSecret.trim() }
        : {}),
      ...(input.scopes?.trim() ? { scopes: input.scopes.trim() } : {}),
    }),
  );
}

/** Secret kind expected for a given server auth method. */
export function upstreamSecretKind(
  authMethod: "api_key" | "oauth" | "mtls",
): string {
  if (authMethod === "oauth") return "oauth";
  if (authMethod === "api_key") return "api_key";
  return "mtls";
}
