import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { startMockUpstreamMcp } from "./helpers/mockUpstream.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("gateway tools/call + audit", () => {
  const upstreamToolName = "echo";
  let mockBaseUrl = "";
  let stopMock: (() => Promise<void>) | undefined;

  it("proxies tools/call to upstream and writes an allow audit event", async () => {
    const mock = await startMockUpstreamMcp(upstreamToolName);
    mockBaseUrl = mock.baseUrl;
    stopMock = mock.stop;

    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(
      client,
      "gateway-tools-call",
    );
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "gateway-tools-call",
      {
        baseUrl: mockBaseUrl,
        toolName: upstreamToolName,
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    );

    const callRes = await client.gatewayMcp(access.gatewayToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: access.mcpToolName,
        arguments: { message: "phase-a" },
      },
    });

    const callText = await callRes.text();
    assert.equal(callRes.ok, true, callText);
    assert.match(callText, /echo:phase-a/);

    const audit = await client.api<{
      items: Array<{
        connectionId: string | null;
        toolId: string | null;
        toolName: string;
        outcome: string;
      }>;
    }>(`/api/v1/audit-events?connectionId=${access.connectionId}&limit=10`, {
      tenantId,
    });

    const allowEvent = audit.data.items.find(
      (event) =>
        event.outcome === "allow" &&
        event.toolId === access.toolId &&
        event.connectionId === access.connectionId,
    );
    assert.ok(allowEvent, "expected allow audit event for tools/call");
    assert.equal(allowEvent.toolName, access.mcpToolName);
  });

  after(async () => {
    if (stopMock) await stopMock();
  });
});
