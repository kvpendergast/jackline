import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ApiClient } from "./helpers/client.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";
import {
  startQuotaTestStack,
  type QuotaTestStack,
} from "./helpers/quotaStack.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("gateway rate limit deny audit", () => {
  let stack: QuotaTestStack;

  before(async () => {
    stack = await startQuotaTestStack({
      JACKLINE_RL_GATEWAY_MCP_LIMIT: "3",
      JACKLINE_RL_GATEWAY_MCP_WINDOW: "60s",
    });
  });

  after(async () => {
    await stack.stop();
  });

  it("returns 429 and writes a deny audit event when gateway.mcp is exceeded", async () => {
    const client = new ApiClient(stack.apiUrl, stack.gatewayUrl, stack.webOrigin);
    const { tenantId } = await createAuthenticatedAdmin(
      client,
      "gateway-rl-audit",
    );
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "gateway-rl-audit",
      { baseUrl: "https://example.com/mcp" },
    );

    const statuses: number[] = [];
    let limited: Response | undefined;

    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${stack.gatewayUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access.gatewayToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "X-Forwarded-For": "198.51.100.40",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: i,
          method: "tools/list",
        }),
      });
      statuses.push(res.status);
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    assert.ok(
      limited,
      `expected a 429 within 6 MCP requests, got statuses=${statuses.join(",")}`,
    );
    assert.equal(limited.headers.get("RateLimit-Limit"), "3");

    const body = (await limited.json()) as {
      error?: { code?: string };
    };
    assert.equal(body.error?.code, "RATE_LIMITED");

    // Audit insert is best-effort; give the writer a brief moment.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const audit = await client.api<{
      items: Array<{
        connectionId: string | null;
        toolName: string;
        outcome: string;
        reason: string | null;
      }>;
    }>(
      `/api/v1/audit-events?connectionId=${access.connectionId}&outcome=deny&limit=20`,
      { tenantId },
    );

    const denyEvent = audit.data.items.find(
      (event) =>
        event.toolName === "gateway.mcp" &&
        event.outcome === "deny" &&
        event.connectionId === access.connectionId,
    );
    assert.ok(denyEvent, "expected deny audit event for gateway.mcp rate limit");
    assert.equal(denyEvent.reason, "RATE_LIMITED");
  });
});
