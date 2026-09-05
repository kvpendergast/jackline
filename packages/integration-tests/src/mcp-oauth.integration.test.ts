import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";
import type { ApiClient } from "./helpers/client.js";

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Ephemeral HTTPS server for CIMD metadata (API process fetches it). */
async function serveCimdMetadata(document: Record<string, unknown>): Promise<{
  metadataUrl: string;
  close: () => Promise<void>;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  // Node accepts PEM key + self-signed cert built via openssl-less workaround:
  // use a minimal cert from `node:crypto` X509Certificate when available is complex;
  // instead spawn openssl if present, else fall back to a fixed test cert.
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "jackline-cimd-"));
  try {
    writeFileSync(join(dir, "key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
    writeFileSync(
      join(dir, "pub.pem"),
      publicKey.export({ type: "spki", format: "pem" }),
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-x509",
        "-key",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    const key = readFileSync(join(dir, "key.pem"));
    const cert = readFileSync(join(dir, "cert.pem"));

    const body = JSON.stringify(document);
    const server = createHttpsServer({ key, cert }, (req, res) => {
      if (req.url === "/client.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const metadataUrl = `https://127.0.0.1:${port}/client.json`;
    // Document client_id must equal the URL.
    document["client_id"] = metadataUrl;
    const refreshed = JSON.stringify(document);
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      if (req.url === "/client.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(refreshed);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    return {
      metadataUrl,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

async function completeMcpOauth(input: {
  client: ApiClient;
  clientId: string;
  redirectUri: string;
  tenantSlug: string;
  resource: string;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const { client, clientId, redirectUri, tenantSlug, resource } = input;
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(8).toString("hex");

  const authorizeUrl = new URL(`${client.apiUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", resource);
  authorizeUrl.searchParams.set("scope", "mcp");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("tenant", tenantSlug);

  const authorizeRes = await fetch(authorizeUrl, {
    headers: {
      Accept: "text/html",
      Cookie: client.cookieHeader(),
      Origin: client.webOrigin,
    },
    redirect: "manual",
  });
  const authorizeBody = await authorizeRes.text();
  assert.equal(
    authorizeRes.status,
    200,
    `authorize expected 200, got ${authorizeRes.status}: ${authorizeBody}`,
  );
  assert.match(authorizeBody, /Allow MCP access/);

  const consentBody = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: "mcp",
    state,
    tenant: tenantSlug,
  });

  const consentRes = await fetch(`${client.apiUrl}/oauth/authorize/consent`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Cookie: client.cookieHeader(),
      Origin: client.webOrigin,
    },
    body: consentBody,
    redirect: "manual",
  });
  assert.equal(
    consentRes.status,
    302,
    `consent expected 302, got ${consentRes.status}: ${await consentRes.text()}`,
  );
  const location = consentRes.headers.get("location");
  assert.ok(location, "consent redirect Location missing");
  const redirected = new URL(location);
  assert.equal(redirected.searchParams.get("state"), state);
  const code = redirected.searchParams.get("code");
  assert.ok(code, "authorization code missing from redirect");

  const tokenRes = await fetch(`${client.apiUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource,
      tenant: tenantSlug,
    }),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  assert.equal(
    tokenRes.ok,
    true,
    `token exchange failed: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`,
  );
  assert.ok(tokenJson.access_token?.startsWith("jackline_mcp_"));
  assert.ok(tokenJson.refresh_token);
  assert.equal(tokenJson.token_type, "Bearer");

  return {
    accessToken: tokenJson.access_token!,
    refreshToken: tokenJson.refresh_token!,
  };
}

describe("MCP OAuth (CIMD + DCR)", () => {
  it("publishes AS and protected-resource metadata", async () => {
    const client = await createApiClient();

    const asRes = await fetch(
      `${client.apiUrl}/.well-known/oauth-authorization-server`,
    );
    assert.equal(asRes.ok, true);
    const asJson = (await asRes.json()) as {
      issuer: string;
      registration_endpoint: string;
      authorization_endpoint: string;
      token_endpoint: string;
      client_id_metadata_document_supported: boolean;
    };
    assert.equal(asJson.issuer, client.apiUrl);
    assert.equal(
      asJson.registration_endpoint,
      `${client.apiUrl}/oauth/register`,
    );
    assert.equal(
      asJson.authorization_endpoint,
      `${client.apiUrl}/oauth/authorize`,
    );
    assert.equal(asJson.token_endpoint, `${client.apiUrl}/oauth/token`);
    assert.equal(asJson.client_id_metadata_document_supported, true);

    const prmRes = await fetch(
      `${client.gatewayUrl}/.well-known/oauth-protected-resource`,
    );
    assert.equal(prmRes.ok, true);
    const prmJson = (await prmRes.json()) as {
      resource: string;
      authorization_servers: string[];
    };
    assert.equal(prmJson.resource, `${client.gatewayUrl}/mcp`);
    assert.deepEqual(prmJson.authorization_servers, [client.apiUrl]);
  });

  it("DCR → authorize → token → gateway initialize (deprecated path)", async () => {
    const client = await createApiClient();
    const { tenantSlug } = await createAuthenticatedAdmin(
      client,
      "mcp-oauth-dcr",
    );
    const redirectUri = "http://127.0.0.1:9/callback";
    const resource = `${client.gatewayUrl}/mcp`;

    const registerRes = await fetch(
      `${client.apiUrl}/oauth/register?tenant=${encodeURIComponent(tenantSlug)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Grok Bot Integration",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
          application_type: "native",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      },
    );
    const registered = (await registerRes.json()) as {
      client_id?: string;
      error?: string;
      error_description?: string;
    };
    assert.equal(
      registerRes.status,
      201,
      registered.error_description ??
        registered.error ??
        String(registerRes.status),
    );
    assert.ok(registered.client_id?.startsWith("dcr_"));

    const { accessToken, refreshToken } = await completeMcpOauth({
      client,
      clientId: registered.client_id!,
      redirectUri,
      tenantSlug,
      resource,
    });

    const initRes = await client.gatewayMcp(accessToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-oauth-dcr", version: "0" },
      },
    });
    assert.equal(initRes.ok, true, await initRes.text());

    const refreshRes = await fetch(`${client.apiUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: registered.client_id!,
        resource,
        tenant: tenantSlug,
      }),
    });
    const refreshed = (await refreshRes.json()) as {
      access_token?: string;
    };
    assert.equal(refreshRes.ok, true);
    assert.ok(refreshed.access_token?.startsWith("jackline_mcp_"));
  });

  it("CIMD client_id → authorize → token → gateway initialize", async () => {
    const client = await createApiClient();
    const { tenantSlug } = await createAuthenticatedAdmin(
      client,
      "mcp-oauth-cimd",
    );
    const redirectUri = "http://127.0.0.1:9/cimd-callback";
    const resource = `${client.gatewayUrl}/mcp`;

    const cimd = await serveCimdMetadata({
      client_id: "https://placeholder.invalid/client.json",
      client_name: "CIMD Integration Host",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "native",
    });

    try {
      const { accessToken } = await completeMcpOauth({
        client,
        clientId: cimd.metadataUrl,
        redirectUri,
        tenantSlug,
        resource,
      });

      const initRes = await client.gatewayMcp(accessToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-oauth-cimd", version: "0" },
        },
      });
      assert.equal(initRes.ok, true, await initRes.text());
    } finally {
      await cimd.close();
    }
  });

  it("gateway challenges unauthenticated /mcp with resource_metadata", async () => {
    const client = await createApiClient();
    const res = await fetch(`${client.gatewayUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "anon", version: "0" },
        },
      }),
    });
    assert.equal(res.status, 401);
    const www = res.headers.get("www-authenticate") ?? "";
    assert.ok(
      www.includes("resource_metadata="),
      `expected resource_metadata= in WWW-Authenticate, got: ${www}`,
    );
    assert.match(www, /oauth-protected-resource/);
  });
});
