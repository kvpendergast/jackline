import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("OAuth client_credentials", () => {
  it("token exchange grants Bearer access to the public admin API", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(
      client,
      "oauth-client-credentials",
    );

    const apiClient = await client.api<{ id: string }>("/api/v1/clients", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: `integration-api-client-${Date.now()}`,
        kind: "service",
      }),
    });

    const creds = await client.api<{
      clientId: string;
      clientSecret: string;
      tokenUrl: string;
    }>(`/api/v1/clients/${apiClient.data.id}/credentials`, {
      method: "POST",
      tenantId,
      body: "{}",
    });

    const tokenRes = await fetch(creds.data.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.data.clientId,
        client_secret: creds.data.clientSecret,
      }),
    });

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
    };
    assert.equal(tokenRes.ok, true);
    assert.ok(tokenJson.access_token);

    const bearerServers = await fetch(`${client.apiUrl}/api/v1/servers?limit=5`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenJson.access_token}`,
        Origin: client.webOrigin,
      },
    });

    const bearerJson = (await bearerServers.json()) as {
      success?: boolean;
    };
    assert.equal(bearerServers.ok, true);
    assert.equal(bearerJson.success, true);
  });
});
