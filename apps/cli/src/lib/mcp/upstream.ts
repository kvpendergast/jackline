import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  encodeOAuthSecretValue,
  getConnectorPreset,
  parseUpstreamOAuthSecret,
  resolveOAuthAccessToken,
} from "@jackline/shared";
import consola from "consola";
import type { JacklineConfigServer, JacklinePaths } from "../paths.js";
import { getSecretPlaintext, putSecret } from "../secrets.js";
import { runBrowserOAuthConnect } from "../oauthConnect.js";

export type ConnectedUpstream = {
  client: Client;
  close: () => Promise<void>;
};

const oauthReconnectInFlight = new Map<string, Promise<string>>();

function isInvalidTokenError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /invalid_token|invalid access token|unauthorized/i.test(message);
}

function isJsonRpcEnvelope(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isJsonRpcEnvelope);
  }
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row["jsonrpc"] !== "2.0") return false;
  return "result" in row || "error" in row || "method" in row;
}

/**
 * Google Workspace MCP sometimes returns a valid JSON-RPC body with a
 * non-2xx HTTP status (transcoding / size). The MCP SDK treats that as a
 * transport failure and drops the payload — remap those to 200.
 */
async function fetchMcp(url: string | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.ok) return response;

  const text = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  if (!isJsonRpcEnvelope(parsed)) {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  consola.debug(
    `Upstream HTTP ${response.status} with JSON-RPC body; treating as 200`,
  );
  const headers = new Headers(response.headers);
  if (!headers.get("content-type")?.includes("json")) {
    headers.set("content-type", "application/json");
  }
  return new Response(text, {
    status: 200,
    statusText: "OK",
    headers,
  });
}

type UpstreamAuth = {
  bearer: string;
};

export async function resolveUpstreamAuth(
  server: JacklineConfigServer,
  paths?: JacklinePaths,
  options?: {
    forceRefresh?: boolean;
    /**
     * If a refresh attempt fails (e.g. refresh token revoked), open the
     * browser-based OAuth connect flow so the user can re-auth.
     */
    autoReconnectOnRefreshFailure?: boolean;
  },
): Promise<UpstreamAuth> {
  if (server.authMethod === "mtls") {
    throw new Error(
      `Server "${server.name}" uses mTLS, which is not supported yet`,
    );
  }

  const secret = await getSecretPlaintext(server.secretId, paths);

  if (server.authMethod === "api_key" || secret.kind === "api_key") {
    return { bearer: secret.value };
  }

  const token = await resolveOAuthAccessToken(
    secret.value,
    options?.forceRefresh ? { forceRefresh: true } : undefined,
  );
  if (token.isErr()) {
    if (options?.autoReconnectOnRefreshFailure && options?.forceRefresh) {
      const existing = oauthReconnectInFlight.get(server.secretId);
      if (existing) {
        try {
          return { bearer: await existing };
        } catch {
          // Fall through to the original refresh error message below.
        }
      }

      const reconnect = (async () => {
        const parsed = parseUpstreamOAuthSecret(secret.value);
        if (parsed.isErr()) {
          throw new Error(parsed.error.message);
        }
        if (typeof parsed.value === "string") {
          throw new Error("Not a refreshable OAuth secret");
        }
        const oauthSecret = parsed.value;
        if (!oauthSecret.refreshToken || !oauthSecret.tokenUrl) {
          throw new Error("OAuth secret has no refresh token");
        }
        if (!oauthSecret.clientId || !oauthSecret.clientSecret) {
          throw new Error("OAuth secret is missing client id/secret");
        }
        if (!server.connectorKey) {
          throw new Error(
            "No catalog preset available to build an authorization URL",
          );
        }

        const preset = getConnectorPreset(server.connectorKey);
        if (!preset?.oauthAuthorizeUrl) {
          throw new Error(
            `No OAuth authorize URL available for preset "${server.connectorKey}"`,
          );
        }

        // For automatic re-auth, we use the same default redirect port as
        // `jackline connect`. If the user registered a different port, they
        // may need to run `jackline connect ... --callback-port <port>` once.
        const callbackPort = 9786;
        const scopes = oauthSecret.scopes || preset.oauthScopes || undefined;

        consola.warn(
          `Upstream OAuth refresh failed for "${server.name}"; opening browser OAuth connect to re-auth...`,
        );

        const tokens = await runBrowserOAuthConnect({
          authorizeUrl: preset.oauthAuthorizeUrl,
          tokenUrl: oauthSecret.tokenUrl,
          clientId: oauthSecret.clientId,
          clientSecret: oauthSecret.clientSecret,
          scopes,
          extraParams: preset.oauthAuthorizeExtraParams,
          callbackPort,
        });

        const encoded = tokens.refreshToken
          ? encodeOAuthSecretValue({
              mode: "refreshable",
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              tokenUrl: tokens.tokenUrl,
              clientId: tokens.clientId,
              clientSecret: tokens.clientSecret,
              ...(scopes ? { scopes } : {}),
              ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
            })
          : encodeOAuthSecretValue({
              mode: "access_token",
              accessToken: tokens.accessToken,
              tokenUrl: tokens.tokenUrl,
              clientId: tokens.clientId,
              clientSecret: tokens.clientSecret,
              ...(scopes ? { scopes } : {}),
              ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
            });

        if (encoded.isErr()) {
          throw new Error(encoded.error.message);
        }

        await putSecret(
          {
            secretId: server.secretId,
            kind: "oauth",
            plaintext: encoded.value,
          },
          paths,
        );

        return tokens.accessToken;
      })()
        .finally(() => {
          oauthReconnectInFlight.delete(server.secretId);
        });

      oauthReconnectInFlight.set(server.secretId, reconnect);
      try {
        return { bearer: await reconnect };
      } catch (reconnectError) {
        // Fall through to the original refresh error message below.
        consola.warn(
          `Automatic OAuth reconnect failed for "${server.name}": ${
            reconnectError instanceof Error ? reconnectError.message : String(reconnectError)
          }`,
        );
      }
    }

    throw new Error(
      `Failed to resolve OAuth token for "${server.name}": ${token.error.message}. Re-run \`jackline connect ${server.connectorKey ?? server.name}\`.`,
    );
  }

  if (token.value.updatedPlaintext) {
    await putSecret(
      {
        secretId: server.secretId,
        kind: "oauth",
        plaintext: token.value.updatedPlaintext,
      },
      paths,
    );
  }

  return {
    bearer: token.value.accessToken,
  };
}

async function openUpstream(
  server: JacklineConfigServer,
  auth: UpstreamAuth,
): Promise<ConnectedUpstream> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(server.baseUrl);
  } catch {
    throw new Error(`Invalid baseUrl for "${server.name}": ${server.baseUrl}`);
  }

  const transport = new StreamableHTTPClientTransport(baseUrl, {
    fetch: fetchMcp,
    requestInit: {
      headers: {
        Authorization: `Bearer ${auth.bearer}`,
      },
    },
  });
  const client = new Client({ name: "jackline-cli", version: "0.0.0" });

  try {
    await client.connect(transport as unknown as Transport);
  } catch (cause) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Upstream MCP connection failed for "${server.name}": ${detail}`,
    );
  }

  return {
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    },
  };
}

export async function connectUpstream(
  server: JacklineConfigServer,
  paths?: JacklinePaths,
): Promise<ConnectedUpstream> {
  const auth = await resolveUpstreamAuth(server, paths);
  try {
    return await openUpstream(server, auth);
  } catch (cause) {
    if (!isInvalidTokenError(cause) || server.authMethod !== "oauth") {
      throw cause;
    }

    const refreshed = await resolveUpstreamAuth(server, paths, {
      forceRefresh: true,
      autoReconnectOnRefreshFailure: true,
    });
    if (refreshed.bearer === auth.bearer) {
      throw cause;
    }
    return openUpstream(server, refreshed);
  }
}
