import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";
import type { ApiClient } from "./helpers/client.js";

/**
 * `jackline login --server <url>`: browser authorization_code + PKCE against
 * /oauth/authorize + /oauth/token with resource=<api>/api/v1, using the
 * pre-registered public `jackline-cli` client and a loopback redirect on an
 * arbitrary port (RFC 8252).
 */

const CLI_CLIENT_ID = "jackline-cli";

/**
 * /oauth/token, /oauth/register and /oauth/revoke share the per-IP
 * `api.auth` bucket (30/min) with signup + sign-in for the whole suite. Give
 * each test its own documentation-range client IP so this file never starves
 * the other suites, and create only two users for the whole file.
 */
let quotaIpCounter = 0;
let quotaIp = "198.51.100.1";
function quotaHeaders(): Record<string, string> {
  return { "x-forwarded-for": quotaIp };
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function randomLoopbackRedirect(): string {
  const port = 20_000 + Math.floor(Math.random() * 40_000);
  return `http://127.0.0.1:${port}/callback`;
}

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postForm(
  url: string,
  body: Record<string, string>,
): Promise<{ status: number; json: TokenJson }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...quotaHeaders(),
    },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as TokenJson) : {} };
}

/** authorize (GET, consent page) → consent (POST) → code. */
async function authorizeForCode(input: {
  client: ApiClient;
  clientId: string;
  redirectUri: string;
  tenantSlug: string;
  resource?: string;
  scope?: string;
  expectConsent?: RegExp;
}): Promise<{ code: string; verifier: string }> {
  const { client, clientId, redirectUri, tenantSlug } = input;
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(8).toString("hex");
  const params: Record<string, string> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    tenant: tenantSlug,
  };
  if (input.resource) params["resource"] = input.resource;
  if (input.scope) params["scope"] = input.scope;

  const authorizeUrl = new URL(`${client.apiUrl}/oauth/authorize`);
  for (const [k, v] of Object.entries(params)) authorizeUrl.searchParams.set(k, v);
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
  if (input.expectConsent) assert.match(authorizeBody, input.expectConsent);

  // Consent form re-posts the validated params (scope/resource as rendered).
  const hidden = Object.fromEntries(
    [...authorizeBody.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
    ]),
  );
  const consentRes = await fetch(`${client.apiUrl}/oauth/authorize/consent`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Cookie: client.cookieHeader(),
      Origin: client.webOrigin,
    },
    body: new URLSearchParams(hidden),
    redirect: "manual",
  });
  assert.equal(
    consentRes.status,
    302,
    `consent expected 302, got ${consentRes.status}: ${await consentRes.text()}`,
  );
  const location = new URL(consentRes.headers.get("location")!);
  assert.equal(`${location.origin}${location.pathname}`, redirectUri);
  assert.equal(location.searchParams.get("state"), state);
  const code = location.searchParams.get("code");
  assert.ok(code, "authorization code missing");
  return { code, verifier };
}

async function cliLogin(input: {
  client: ApiClient;
  tenantSlug: string;
  apiResource: string;
}): Promise<{ accessToken: string; refreshToken: string; json: TokenJson }> {
  const redirectUri = randomLoopbackRedirect();
  const { code, verifier } = await authorizeForCode({
    client: input.client,
    clientId: CLI_CLIENT_ID,
    redirectUri,
    tenantSlug: input.tenantSlug,
    resource: input.apiResource,
    expectConsent: /Allow Jackline API access/,
  });
  const { status, json } = await postForm(`${input.client.apiUrl}/oauth/token`, {
    grant_type: "authorization_code",
    code,
    client_id: CLI_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: input.apiResource,
    tenant: input.tenantSlug,
  });
  assert.equal(status, 200, `token exchange failed: ${JSON.stringify(json)}`);
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token!,
    json,
  };
}

async function bearerGet(
  client: ApiClient,
  path: string,
  token: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${client.apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function gatewayInitialize(client: ApiClient, token: string): Promise<Response> {
  return client.gatewayMcp(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cli-oauth-login", version: "0" },
    },
  });
}

async function dcrRegister(
  client: ApiClient,
  tenantSlug: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(
    `${client.apiUrl}/oauth/register?tenant=${encodeURIComponent(tenantSlug)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...quotaHeaders() },
      body: JSON.stringify({
        client_name: "Third-party MCP host",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        application_type: "native",
      }),
    },
  );
  const json = (await res.json()) as { client_id?: string };
  assert.equal(res.status, 201);
  return json.client_id!;
}

describe("CLI OAuth login → Jackline API user tokens", () => {
  /** Tenant A owner (full_admin). */
  let client: ApiClient;
  let tenantId: string;
  let tenantSlug: string;
  let email: string;
  /** Second user: full_admin of tenant B, `member` of tenant A. */
  let memberClient: ApiClient;
  let memberTenantSlug: string;

  before(async () => {
    const { db, memberships, user: userTable } = await import("@jackline/db");
    const { eq } = await import("drizzle-orm");
    client = await createApiClient();
    ({ tenantId, tenantSlug, email } = await createAuthenticatedAdmin(
      client,
      "cli-login-owner",
    ));
    memberClient = await createApiClient();
    const member = await createAuthenticatedAdmin(memberClient, "cli-login-member");
    memberTenantSlug = member.tenantSlug;
    const [memberUser] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, member.email))
      .limit(1);
    await db.insert(memberships).values({
      userId: memberUser!.id,
      tenantId,
      role: "member",
    });
  });

  beforeEach(() => {
    quotaIpCounter += 1;
    quotaIp = `198.51.100.${quotaIpCounter}`;
  });

  it("advertises the API resource, CLI client and revocation endpoint", async () => {
    const res = await fetch(`${client.apiUrl}/.well-known/oauth-authorization-server`);
    const meta = (await res.json()) as Record<string, unknown>;
    assert.equal(meta["jackline_api_resource"], `${client.apiUrl}/api/v1`);
    assert.equal(meta["jackline_mcp_resource"], `${client.gatewayUrl}/mcp`);
    assert.equal(meta["jackline_cli_client_id"], CLI_CLIENT_ID);
    assert.equal(meta["jackline_tenancy"], "multi");
    assert.equal(meta["revocation_endpoint"], `${client.apiUrl}/oauth/revoke`);
    assert.ok((meta["scopes_supported"] as string[]).includes("api"));
  });

  it("PKCE login issues a short-lived API token the API accepts; /me returns user, tenant, role, mcpUrl", async () => {
    const apiResource = `${client.apiUrl}/api/v1`;
    const { accessToken, refreshToken, json } = await cliLogin({
      client,
      tenantSlug,
      apiResource,
    });
    assert.ok(accessToken.startsWith("jackline_uat_"), accessToken.slice(0, 16));
    assert.ok(refreshToken.startsWith("jackline_urt_"));
    assert.equal(json.token_type, "Bearer");
    assert.equal(json.expires_in, 900);
    assert.equal(json.scope, "api");

    const me = await bearerGet(client, "/api/v1/me", accessToken);
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.data.user.email, email);
    assert.equal(me.body.data.current.tenantId, tenantId);
    assert.equal(me.body.data.current.role, "full_admin");
    assert.equal(me.body.data.current.authMethod, "oauth_authorization_code");
    assert.equal(me.body.data.mcpUrl, `${client.gatewayUrl}/mcp`);
    assert.equal(me.body.data.memberships.length, 1);
    assert.equal(me.body.data.memberships[0].tenant.slug, tenantSlug);

    // Tenant-scoped route, no X-Jackline-Tenant-Id header needed.
    const servers = await bearerGet(client, "/api/v1/me/servers", accessToken);
    assert.equal(servers.status, 200, JSON.stringify(servers.body));

    // A mismatching tenant header is refused.
    const mismatch = await fetch(`${client.apiUrl}/api/v1/me/servers`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Jackline-Tenant-Id": "00000000-0000-4000-8000-000000000000",
      },
    });
    assert.equal(mismatch.status, 403);
  });

  it("keeps audiences separate: MCP tokens are rejected by the API and API tokens by the gateway", async () => {
    const apiResource = `${client.apiUrl}/api/v1`;
    const mcpResource = `${client.gatewayUrl}/mcp`;

    // MCP token via a third-party (DCR) client.
    const mcpRedirect = randomLoopbackRedirect();
    const dcrClientId = await dcrRegister(client, tenantSlug, mcpRedirect);
    const mcpCode = await authorizeForCode({
      client,
      clientId: dcrClientId,
      redirectUri: mcpRedirect,
      tenantSlug,
      resource: mcpResource,
      scope: "mcp",
      expectConsent: /Allow MCP access/,
    });
    const mcpToken = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code: mcpCode.code,
      client_id: dcrClientId,
      redirect_uri: mcpRedirect,
      code_verifier: mcpCode.verifier,
      resource: mcpResource,
      tenant: tenantSlug,
    });
    assert.equal(mcpToken.status, 200, JSON.stringify(mcpToken.json));
    const mcpAccess = mcpToken.json.access_token!;
    assert.ok(mcpAccess.startsWith("jackline_mcp_"));

    const gatewayOk = await gatewayInitialize(client, mcpAccess);
    assert.equal(gatewayOk.ok, true, await gatewayOk.text());
    const apiWithMcp = await bearerGet(client, "/api/v1/me/servers", mcpAccess);
    assert.equal(apiWithMcp.status, 401);
    const meWithMcp = await bearerGet(client, "/api/v1/me", mcpAccess);
    assert.equal(meWithMcp.status, 401);

    // API token via the CLI client is rejected by the MCP gateway.
    const { accessToken: apiAccess } = await cliLogin({ client, tenantSlug, apiResource });
    const gatewayWithApi = await gatewayInitialize(client, apiAccess);
    assert.equal(gatewayWithApi.status, 401, await gatewayWithApi.text());

    // A third-party client cannot request the API resource…
    const thirdPartyApi = new URL(`${client.apiUrl}/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: dcrClientId,
      redirect_uri: mcpRedirect,
      code_challenge: pkcePair().challenge,
      code_challenge_method: "S256",
      resource: apiResource,
      tenant: tenantSlug,
    })) {
      thirdPartyApi.searchParams.set(k, v);
    }
    const denied = await fetch(thirdPartyApi, {
      headers: { Cookie: client.cookieHeader() },
      redirect: "manual",
    });
    assert.equal(denied.status, 400, await denied.text());

    // …and the CLI client cannot mint MCP tokens.
    const cliMcp = new URL(`${client.apiUrl}/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: CLI_CLIENT_ID,
      redirect_uri: randomLoopbackRedirect(),
      code_challenge: pkcePair().challenge,
      code_challenge_method: "S256",
      resource: mcpResource,
      tenant: tenantSlug,
    })) {
      cliMcp.searchParams.set(k, v);
    }
    const cliDenied = await fetch(cliMcp, {
      headers: { Cookie: client.cookieHeader() },
      redirect: "manual",
    });
    assert.equal(cliDenied.status, 400, await cliDenied.text());
  });

  it("rejects bad PKCE verifiers, unregistered redirects and code replay", async () => {
    const apiResource = `${client.apiUrl}/api/v1`;
    const redirectUri = randomLoopbackRedirect();
    const { code, verifier } = await authorizeForCode({
      client,
      clientId: CLI_CLIENT_ID,
      redirectUri,
      tenantSlug,
      resource: apiResource,
    });

    const bad = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      client_id: CLI_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: randomBytes(32).toString("base64url"),
      tenant: tenantSlug,
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, "invalid_grant");

    // resource omitted at /token → bound resource from the code is used.
    const good = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      client_id: CLI_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      tenant: tenantSlug,
    });
    assert.equal(good.status, 200, JSON.stringify(good.json));
    assert.ok(good.json.access_token?.startsWith("jackline_uat_"));

    const replay = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      client_id: CLI_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      tenant: tenantSlug,
    });
    assert.equal(replay.status, 400);

    const evilRedirect = new URL(`${client.apiUrl}/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: CLI_CLIENT_ID,
      redirect_uri: "http://localhost:8123/callback",
      code_challenge: pkcePair().challenge,
      code_challenge_method: "S256",
      resource: apiResource,
      tenant: tenantSlug,
    })) {
      evilRedirect.searchParams.set(k, v);
    }
    const evil = await fetch(evilRedirect, {
      headers: { Cookie: client.cookieHeader() },
      redirect: "manual",
    });
    assert.equal(evil.status, 400);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const apiResource = `${client.apiUrl}/api/v1`;
    const first = await cliLogin({ client, tenantSlug, apiResource });

    const refreshed = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: first.refreshToken,
      client_id: CLI_CLIENT_ID,
      tenant: tenantSlug,
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json));
    const second = {
      accessToken: refreshed.json.access_token!,
      refreshToken: refreshed.json.refresh_token!,
    };
    assert.ok(second.accessToken.startsWith("jackline_uat_"));
    assert.notEqual(second.accessToken, first.accessToken);
    assert.notEqual(second.refreshToken, first.refreshToken);

    // Rotated-out access token no longer works; the new one does.
    assert.equal((await bearerGet(client, "/api/v1/me", first.accessToken)).status, 401);
    assert.equal((await bearerGet(client, "/api/v1/me", second.accessToken)).status, 200);

    // Reusing the old refresh token fails and revokes the live successor.
    const reuse = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: first.refreshToken,
      client_id: CLI_CLIENT_ID,
      tenant: tenantSlug,
    });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.json.error, "invalid_grant");
    assert.equal((await bearerGet(client, "/api/v1/me", second.accessToken)).status, 401);
    const afterReuse = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: second.refreshToken,
      client_id: CLI_CLIENT_ID,
      tenant: tenantSlug,
    });
    assert.equal(afterReuse.status, 400);
  });

  it("rejects expired access tokens and idle-expired refresh tokens", async () => {
    const apiResource = `${client.apiUrl}/api/v1`;
    const { accessToken, refreshToken } = await cliLogin({ client, tenantSlug, apiResource });

    const { db, oauthAccessTokens } = await import("@jackline/db");
    const { eq } = await import("drizzle-orm");
    const tokenHash = createHash("sha256").update(accessToken).digest("hex");

    await db
      .update(oauthAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(oauthAccessTokens.tokenHash, tokenHash));
    const expired = await bearerGet(client, "/api/v1/me", accessToken);
    assert.equal(expired.status, 401);
    const expiredTenant = await bearerGet(client, "/api/v1/me/servers", accessToken);
    assert.equal(expiredTenant.status, 401);

    // Expired access token can still be refreshed within the idle window.
    const refreshed = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLI_CLIENT_ID,
      tenant: tenantSlug,
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json));

    // Past the 30-day idle window the refresh token is dead.
    const newHash = createHash("sha256")
      .update(refreshed.json.access_token!)
      .digest("hex");
    await db
      .update(oauthAccessTokens)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(oauthAccessTokens.tokenHash, newHash));
    const stale = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: refreshed.json.refresh_token!,
      client_id: CLI_CLIENT_ID,
      tenant: tenantSlug,
    });
    assert.equal(stale.status, 400);
    assert.equal(stale.json.error, "invalid_grant");
  });

  it("revocation (logout) kills both the access and refresh token", async () => {
    const apiResource = `${client.apiUrl}/api/v1`;
    const { accessToken, refreshToken } = await cliLogin({ client, tenantSlug, apiResource });

    const revoke = await fetch(`${client.apiUrl}/oauth/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...quotaHeaders(),
      },
      body: new URLSearchParams({
        token: refreshToken,
        client_id: CLI_CLIENT_ID,
        tenant: tenantSlug,
      }),
    });
    assert.equal(revoke.status, 200);
    assert.equal((await bearerGet(client, "/api/v1/me", accessToken)).status, 401);
    const refresh = await postForm(`${client.apiUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLI_CLIENT_ID,
      tenant: tenantSlug,
    });
    assert.equal(refresh.status, 400);

    // Unknown tokens still return 200 (RFC 7009 §2.2).
    const unknown = await fetch(`${client.apiUrl}/oauth/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...quotaHeaders(),
      },
      body: new URLSearchParams({
        token: "jackline_urt_nope",
        client_id: CLI_CLIENT_ID,
        tenant: tenantSlug,
      }),
    });
    assert.equal(unknown.status, 200);
  });

  it("preserves the member role: member token reads member routes but is forbidden on admin routes", async () => {
    const apiResource = `${memberClient.apiUrl}/api/v1`;
    const { accessToken } = await cliLogin({
      client: memberClient,
      tenantSlug,
      apiResource,
    });

    const me = await bearerGet(memberClient, "/api/v1/me", accessToken);
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.data.current.tenantId, tenantId);
    assert.equal(me.body.data.current.role, "member");
    assert.equal(me.body.data.memberships.length, 1, "only the token tenant");

    const servers = await bearerGet(memberClient, "/api/v1/me/servers", accessToken);
    assert.equal(servers.status, 200, JSON.stringify(servers.body));

    const createUser = await fetch(`${memberClient.apiUrl}/api/v1/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "x@jackline.local", name: "X", role: "member" }),
    });
    assert.equal(createUser.status, 403, await createUser.text());
  });

  it("refuses to issue an API code for a tenant the user is not a member of", async () => {
    // Tenant A's owner is not a member of tenant B.
    const outsiderClient = client;
    const otherTenantSlug = memberTenantSlug;
    const redirectUri = randomLoopbackRedirect();
    const { challenge } = pkcePair();
    const consent = await fetch(`${outsiderClient.apiUrl}/oauth/authorize/consent`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Cookie: outsiderClient.cookieHeader(),
        Origin: outsiderClient.webOrigin,
      },
      body: new URLSearchParams({
        response_type: "code",
        client_id: CLI_CLIENT_ID,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: `${outsiderClient.apiUrl}/api/v1`,
        tenant: otherTenantSlug,
      }),
      redirect: "manual",
    });
    assert.equal(consent.status, 403, await consent.text());
  });
});
