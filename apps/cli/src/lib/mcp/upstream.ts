import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resolveOAuthAccessToken } from "@jackline/shared";
import consola from "consola";
import type { JacklineConfigServer, JacklinePaths } from "../paths.js";
import { getSecretPlaintext, putSecret } from "../secrets.js";

export type ConnectedUpstream = {
  client: Client;
  close: () => Promise<void>;
};

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
  options?: { forceRefresh?: boolean },
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
    });
    if (refreshed.bearer === auth.bearer) {
      throw cause;
    }
    return openUpstream(server, refreshed);
  }
}
