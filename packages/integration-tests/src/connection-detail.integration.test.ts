import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("connection detail", () => {
  it("advertises the instance's public MCP URL (not a hardcoded localhost)", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(
      client,
      "connection-detail-mcp-url",
    );
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "connection-detail-mcp-url",
    );

    const detail = await client.api<{ mcpUrl: string }>(
      `/api/v1/connections/${access.connectionId}`,
      { tenantId },
    );

    assert.equal(detail.status, 200);
    const expected = process.env["JACKLINE_PUBLIC_MCP_URL"];
    assert.ok(expected, "integration stack sets JACKLINE_PUBLIC_MCP_URL");
    assert.equal(detail.data.mcpUrl, expected.replace(/\/$/, ""));
  });
});
