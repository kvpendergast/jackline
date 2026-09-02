import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("quarantined connection", () => {
  it("gateway tools/list returns 403 after connection is quarantined", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(
      client,
      "gateway-quarantine",
    );
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "gateway-quarantine",
    );

    await client.api(`/api/v1/connections/${access.connectionId}`, {
      method: "PATCH",
      tenantId,
      body: JSON.stringify({ status: "quarantined" }),
    });

    const denied = await client.gatewayMcp(access.gatewayToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });

    assert.equal(denied.status, 403);
  });
});
