import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("gateway policy deny", () => {
  it("tools/list omits a tool when grant and deny both apply (deny-wins)", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(
      client,
      "gateway-policy-deny",
    );
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "gateway-policy-deny",
      { alsoDeny: true },
    );

    const toolsList = await client.gatewayMcp(access.gatewayToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const toolsText = await toolsList.text();
    assert.equal(toolsList.ok, true);
    assert.doesNotMatch(
      toolsText,
      new RegExp(access.mcpToolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});
