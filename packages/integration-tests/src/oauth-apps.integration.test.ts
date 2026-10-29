import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

type OAuthApp = {
  id: string;
  name: string;
  clientId: string;
  tokenUrl: string | null;
  hasClientSecret: boolean;
  linkedServerCount: number;
};

type Server = { id: string; oauthAppId: string | null };

const SECRET = "integration-shared-app-secret-value";

describe("shared OAuth apps", () => {
  it("CRUD, linking, connect, rotation and delete rules; secret never returned", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "oauth-apps");
    const suffix = Date.now();

    const created = await client.api<OAuthApp>("/api/v1/oauth-apps", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: `Google ${suffix}`,
        clientId: "shared-client.apps.example.com",
        clientSecret: SECRET,
        authorizeUrl: "https://accounts.example.com/o/oauth2/auth",
        tokenUrl: "https://oauth2.example.com/token",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.hasClientSecret, true);
    assert.equal(created.data.linkedServerCount, 0);
    assert.ok(!JSON.stringify(created.data).includes(SECRET));
    assert.ok(!("clientSecret" in created.data));

    // Duplicate names are rejected per tenant.
    await assert.rejects(
      client.api("/api/v1/oauth-apps", {
        method: "POST",
        tenantId,
        body: JSON.stringify({ name: `Google ${suffix}`, clientId: "other" }),
      }),
      /400/,
    );

    // Two servers share the app, with different scopes.
    const servers: Server[] = [];
    for (const [name, scopes] of [
      ["gmail", "https://mail.example.com/scope"],
      ["calendar", "https://calendar.example.com/scope"],
    ] as const) {
      const s = await client.api<Server>("/api/v1/servers", {
        method: "POST",
        tenantId,
        body: JSON.stringify({
          name: `${name}-${suffix}`,
          baseUrl: `https://${name}.example.com/mcp`,
          authMethod: "oauth",
          kind: "mcp",
          credentialMode: "either",
          oauthScopes: scopes,
          oauthAppId: created.data.id,
        }),
      });
      assert.equal(s.data.oauthAppId, created.data.id);
      servers.push(s.data);
    }

    const list = await client.api<{ items: OAuthApp[] }>("/api/v1/oauth-apps", {
      tenantId,
    });
    const listed = list.data.items.find((a) => a.id === created.data.id);
    assert.equal(listed?.linkedServerCount, 2);
    assert.ok(!JSON.stringify(list.data).includes(SECRET));

    // Connect uses the app client id + authorize URL and the server's scopes.
    const start = await client.api<{ authorizeUrl: string }>(
      "/api/v1/oauth/start",
      {
        method: "POST",
        tenantId,
        body: JSON.stringify({ serverId: servers[1]!.id }),
      },
    );
    const url = new URL(start.data.authorizeUrl);
    assert.equal(url.origin + url.pathname, "https://accounts.example.com/o/oauth2/auth");
    assert.equal(url.searchParams.get("client_id"), "shared-client.apps.example.com");
    assert.equal(url.searchParams.get("scope"), "https://calendar.example.com/scope");

    // Rotation and rename keep the secret write-only.
    const rotated = await client.api<OAuthApp>(
      `/api/v1/oauth-apps/${created.data.id}`,
      {
        method: "PATCH",
        tenantId,
        body: JSON.stringify({ name: `Google ${suffix} renamed`, clientSecret: "rotated-secret" }),
      },
    );
    assert.equal(rotated.data.hasClientSecret, true);
    assert.ok(!JSON.stringify(rotated.data).includes("rotated-secret"));

    // Delete is refused while servers are linked…
    await assert.rejects(
      client.api(`/api/v1/oauth-apps/${created.data.id}`, {
        method: "DELETE",
        tenantId,
      }),
      /400.*gmail-/,
    );
    // …and detaches with ?detach=true.
    await client.api(`/api/v1/oauth-apps/${created.data.id}?detach=true`, {
      method: "DELETE",
      tenantId,
    });
    const after = await client.api<Server>(`/api/v1/servers/${servers[0]!.id}`, {
      tenantId,
    });
    assert.equal(after.data.oauthAppId, null);

    // Linking an unknown app is rejected.
    await assert.rejects(
      client.api(`/api/v1/servers/${servers[0]!.id}`, {
        method: "PATCH",
        tenantId,
        body: JSON.stringify({ oauthAppId: created.data.id }),
      }),
      /400/,
    );
  });

  it("saves a server's own client credentials as a shared app", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "oauth-apps-from");
    const suffix = Date.now();

    const server = await client.api<Server>("/api/v1/servers", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: `gmail-${suffix}`,
        baseUrl: "https://gmail.example.com/mcp",
        authMethod: "oauth",
        kind: "mcp",
        oauthAuthorizeUrl: "https://accounts.example.com/auth",
        oauthTokenUrl: "https://oauth2.example.com/token",
        oauthClientId: "per-server-client",
      }),
    });
    await client.api("/api/v1/secrets", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        kind: "oauth_client",
        name: "gmail oauth app",
        value: SECRET,
        serverId: server.data.id,
        userId: null,
        connectionId: null,
      }),
    });

    const app = await client.api<OAuthApp>("/api/v1/oauth-apps/from-server", {
      method: "POST",
      tenantId,
      body: JSON.stringify({ serverId: server.data.id, name: `From gmail ${suffix}` }),
    });
    assert.equal(app.status, 201);
    assert.equal(app.data.clientId, "per-server-client");
    assert.equal(app.data.tokenUrl, "https://oauth2.example.com/token");
    assert.equal(app.data.hasClientSecret, true);
    assert.equal(app.data.linkedServerCount, 1);
    assert.ok(!JSON.stringify(app.data).includes(SECRET));

    const linked = await client.api<Server>(`/api/v1/servers/${server.data.id}`, {
      tenantId,
    });
    assert.equal(linked.data.oauthAppId, app.data.id);
  });
});
