export {
  applyOAuthClientOverride,
  type OAuthClientOverride,
} from "./oauth.js";

/**
 * Shared OAuth apps: resolution rule between a server's own OAuth client
 * fields and a linked, reusable OAuth app.
 *
 * Rule: when the server has `oauthAppId` AND the app was found, the app's
 * client id (and its encrypted secret) win; the app's authorize / token /
 * registration URLs win when set, otherwise the server's own URLs are used.
 * Without a linked app the server's own fields are used exactly as before.
 * Scopes and the RFC 8707 resource always stay per server.
 */

/** Secret-free view of an OAuth app used for resolution. */
export type OAuthAppClientRef = {
  id: string;
  clientId: string;
  authorizeUrl: string | null;
  tokenUrl: string | null;
  registrationUrl: string | null;
  hasClientSecret: boolean;
};

export type ServerOAuthClientFields = {
  oauthAppId: string | null;
  oauthClientId: string | null;
  oauthAuthorizeUrl: string | null;
  oauthTokenUrl: string | null;
  oauthRegistrationUrl: string | null;
};

export type ResolvedServerOAuthClient =
  | {
      source: "app";
      appId: string;
      clientId: string;
      authorizeUrl: string | null;
      tokenUrl: string | null;
      registrationUrl: string | null;
      /** App has no secret → public (PKCE-only) client. */
      publicClient: boolean;
    }
  | {
      source: "server";
      appId: null;
      clientId: string | null;
      authorizeUrl: string | null;
      tokenUrl: string | null;
      registrationUrl: string | null;
      /** Caller decides (catalog flag / registration URL), as before. */
      publicClient: null;
    };

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveServerOAuthClient(
  server: ServerOAuthClientFields,
  app: OAuthAppClientRef | null | undefined,
): ResolvedServerOAuthClient {
  if (server.oauthAppId && app && app.id === server.oauthAppId) {
    return {
      source: "app",
      appId: app.id,
      clientId: app.clientId.trim(),
      authorizeUrl: nonEmpty(app.authorizeUrl) ?? nonEmpty(server.oauthAuthorizeUrl),
      tokenUrl: nonEmpty(app.tokenUrl) ?? nonEmpty(server.oauthTokenUrl),
      registrationUrl:
        nonEmpty(app.registrationUrl) ?? nonEmpty(server.oauthRegistrationUrl),
      publicClient: !app.hasClientSecret,
    };
  }
  return {
    source: "server",
    appId: null,
    clientId: server.oauthClientId,
    authorizeUrl: server.oauthAuthorizeUrl,
    tokenUrl: server.oauthTokenUrl,
    registrationUrl: server.oauthRegistrationUrl,
    publicClient: null,
  };
}

/**
 * AAD for an OAuth app's encrypted client secret. Binds the ciphertext to the
 * tenant and app id so it cannot be swapped onto another app or tenant. Kept
 * disjoint from `secrets` AAD (`tenant|kind|server|user|connection`) by the
 * dedicated kind segment.
 */
export const OAUTH_APP_SECRET_AAD_KIND = "oauth_app_client" as const;

export function oauthAppSecretAad(input: {
  tenantId: string;
  appId: string;
}): Uint8Array {
  return new TextEncoder().encode(
    [input.tenantId, OAUTH_APP_SECRET_AAD_KIND, `app:${input.appId}`, "", ""].join(
      "|",
    ),
  );
}
