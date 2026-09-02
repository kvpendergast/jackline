import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("gateway /mcp", () => {
  it("initialize succeeds with a minted connection token", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "gateway-mcp");
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "gateway-mcp",
    );

    const initRes = await client.gatewayMcp(access.gatewayToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "integration", version: "0" },
      },
    });

    assert.equal(initRes.ok, true);
  });

  it("tools/list includes policy-allowed tools", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "gateway-mcp");
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "gateway-mcp-list",
    );

    const toolsList = await client.gatewayMcp(access.gatewayToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    const toolsText = await toolsList.text();
    assert.equal(toolsList.ok, true);
    assert.match(toolsText, new RegExp(access.toolName.replace("/", "\\/")));
  });
});
