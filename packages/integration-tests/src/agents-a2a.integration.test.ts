import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicAgent, PublicTrustGrant } from "@jackline/shared";

import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";
import { provisionInteractiveMcpAccess } from "./helpers/provision.js";

async function a2aJsonRpc(
  apiUrl: string,
  handle: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${apiUrl}/a2a/${handle}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("agents instructions + tool bindings", () => {
  it("persists instructions and agent-level tool bindings", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "agent-tools");
    const access = await provisionInteractiveMcpAccess(
      client,
      tenantId,
      "agent-bind",
    );

    const created = await client.api<PublicAgent>("/api/v1/agents", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        handle: `bind-${Date.now()}`.slice(0, 32),
        displayName: "Binder",
        instructions: "Use calendar tools carefully.",
      }),
    });
    assert.equal(created.data.instructions, "Use calendar tools carefully.");
    assert.deepEqual(created.data.toolIds, []);
    assert.equal(created.data.publicSkills.length, 1);
    assert.equal(created.data.publicSkills[0]?.id, "contact.leave_message");

    const withTools = await client.api<PublicAgent>(
      `/api/v1/agents/${created.data.id}/tools`,
      {
        method: "PUT",
        tenantId,
        body: JSON.stringify({ toolIds: [access.toolId] }),
      },
    );
    assert.deepEqual(withTools.data.toolIds, [access.toolId]);

    const updated = await client.api<PublicAgent>(
      `/api/v1/agents/${created.data.id}`,
      {
        method: "PATCH",
        tenantId,
        body: JSON.stringify({
          instructions: "Updated instructions for peers.",
          publicSkills: [
            {
              id: "calendar.book",
              name: "Book meeting",
              description: "Schedule on the owner calendar",
            },
            {
              id: "contact.leave_message",
              name: "Leave a message",
              description: "Send a short message to the agent owner",
            },
          ],
        }),
      },
    );
    assert.equal(updated.data.instructions, "Updated instructions for peers.");
    assert.deepEqual(updated.data.toolIds, [access.toolId]);
    assert.deepEqual(
      updated.data.publicSkills.map((skill) => skill.id),
      ["calendar.book", "contact.leave_message"],
    );

    const fetched = await client.api<PublicAgent>(
      `/api/v1/agents/${created.data.id}`,
      { tenantId },
    );
    assert.equal(fetched.data.instructions, "Updated instructions for peers.");
    assert.deepEqual(fetched.data.toolIds, [access.toolId]);

    await client.api(`/api/v1/agents/${created.data.id}/publish`, {
      method: "POST",
      tenantId,
    });

    const directory = await client.api<{
      agents: Array<{ handle: string; publicSkills: string[] }>;
    }>(`/api/v1/networks/public/directory?handle=${created.data.handle}`, {
      tenantId,
    });
    const listed = directory.data.agents.find(
      (row) => row.handle === created.data.handle,
    );
    assert.ok(listed, "expected published agent in directory");
    assert.deepEqual(listed.publicSkills, [
      "calendar.book",
      "contact.leave_message",
    ]);

    const cardRes = await fetch(
      `${client.apiUrl}/agents/${created.data.handle}/.well-known/agent-card.json`,
    );
    if (!cardRes.ok) {
      assert.fail(`agent card HTTP ${cardRes.status}: ${await cardRes.text()}`);
    }
    const card = (await cardRes.json()) as {
      skills: Array<{ id: string; name: string; description: string }>;
    };
    assert.deepEqual(
      card.skills.map((skill) => skill.id),
      ["calendar.book", "contact.leave_message"],
    );
    assert.equal(card.skills[0]?.name, "Book meeting");

    const cleared = await client.api<PublicAgent>(
      `/api/v1/agents/${created.data.id}/tools`,
      {
        method: "PUT",
        tenantId,
        body: JSON.stringify({ toolIds: [] }),
      },
    );
    assert.deepEqual(cleared.data.toolIds, []);

    await assert.rejects(
      () =>
        client.api(`/api/v1/agents/${created.data.id}/tools`, {
          method: "PUT",
          tenantId,
          body: JSON.stringify({
            toolIds: ["00000000-0000-4000-8000-000000000099"],
          }),
        }),
      (err: unknown) =>
        err instanceof Error && /→ 400:/.test(err.message),
    );
  });
});

describe("A2A trust handoff via tasks/get", () => {
  it("surfaces exchangeToken after knock approval", async () => {
    const ownerClient = await createApiClient();
    const peerClient = await createApiClient();
    const owner = await createAuthenticatedAdmin(ownerClient, "agent-owner");
    const peer = await createAuthenticatedAdmin(peerClient, "agent-peer");

    const handle = `trust-${Date.now()}`.slice(0, 32);
    const agent = await ownerClient.api<PublicAgent>("/api/v1/agents", {
      method: "POST",
      tenantId: owner.tenantId,
      body: JSON.stringify({
        handle,
        displayName: "Trust Agent",
        instructions: "Help approved peers.",
        publicSkills: [
          {
            id: "contact.leave_message",
            name: "Leave a message",
            description: "Send a short message",
          },
          {
            id: "calendar.book",
            name: "Book meeting",
            description: "Schedule",
          },
        ],
      }),
    });
    await ownerClient.api(`/api/v1/agents/${agent.data.id}/publish`, {
      method: "POST",
      tenantId: owner.tenantId,
    });

    const peerCardUrl = `http://127.0.0.1/agents/peer-${Date.now()}/.well-known/agent-card.json`;
    const knockRes = await a2aJsonRpc(
      peerClient.apiUrl,
      handle,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          peerAgentCardUrl: peerCardUrl,
          message: {
            role: "user",
            parts: [{ kind: "text", text: "Please grant access" }],
            metadata: {
              intent: "jackline.trust.request",
              peerAgentCardUrl: peerCardUrl,
              peerDisplayName: "Peer Bot",
            },
          },
        },
      },
      {
        Cookie: peerClient.cookieHeader(),
        "X-Jackline-Tenant-Id": peer.tenantId,
      },
    );
    assert.equal(knockRes.status, 200, JSON.stringify(knockRes.json));
    const knockResult = knockRes.json["result"] as {
      knockId: string;
      taskId: string;
      knockSecret: string;
      state: string;
    };
    assert.equal(knockResult.state, "input_required");
    assert.ok(knockResult.knockSecret);
    assert.ok(knockResult.taskId);

    await assert.rejects(
      () =>
        ownerClient.api(`/api/v1/knocks/${knockResult.knockId}/approve`, {
          method: "POST",
          tenantId: owner.tenantId,
          body: JSON.stringify({
            grantTtlSeconds: 3600,
            skillIds: ["not.a.skill"],
          }),
        }),
      (err: unknown) =>
        err instanceof Error && /→ 400:/.test(err.message),
    );

    const approved = await ownerClient.api<PublicTrustGrant>(
      `/api/v1/knocks/${knockResult.knockId}/approve`,
      {
        method: "POST",
        tenantId: owner.tenantId,
        body: JSON.stringify({
          grantTtlSeconds: 3600,
          skillIds: ["calendar.book"],
        }),
      },
    );
    assert.deepEqual(approved.data.skillPolicy.skillIds, ["calendar.book"]);

    const tasksGet = await a2aJsonRpc(
      peerClient.apiUrl,
      handle,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { taskId: knockResult.taskId },
      },
      {
        Cookie: peerClient.cookieHeader(),
        "X-Jackline-Tenant-Id": peer.tenantId,
      },
    );
    assert.equal(tasksGet.status, 200, JSON.stringify(tasksGet.json));
    const taskPayload = tasksGet.json["result"] as {
      taskId: string;
      state: string;
      result?: { exchangeToken?: string; approved?: boolean };
    };
    assert.equal(taskPayload.taskId, knockResult.taskId);
    assert.equal(taskPayload.state, "completed");
    assert.equal(taskPayload.result?.approved, true);
    assert.ok(taskPayload.result?.exchangeToken);

    const exchanged = await peerClient.api<{
      token: string;
      grantId: string;
      expiresAt: string;
    }>("/api/v1/trust/exchange", {
      method: "POST",
      tenantId: peer.tenantId,
      body: JSON.stringify({
        knockSecret: knockResult.knockSecret,
        exchangeToken: taskPayload.result!.exchangeToken,
      }),
    });
    assert.ok(exchanged.data.token.startsWith("jka_"));

    const grantedMessage = await a2aJsonRpc(
      peerClient.apiUrl,
      handle,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: "hello after grant" }],
          },
        },
      },
      {
        Authorization: `Bearer ${exchanged.data.token}`,
      },
    );
    assert.equal(grantedMessage.status, 200, JSON.stringify(grantedMessage.json));
    const messageResult = grantedMessage.json["result"] as { state?: string };
    assert.equal(messageResult.state, "completed");
  });
});

describe("hosted A2A tool execution", () => {
  it("runs a bound tool for a granted peer via jackline.tool.call", async () => {
    const { startMockUpstreamMcp } = await import("./helpers/mockUpstream.js");
    const mock = await startMockUpstreamMcp("echo");
    try {
      const ownerClient = await createApiClient();
      const peerClient = await createApiClient();
      const owner = await createAuthenticatedAdmin(ownerClient, "hosted-owner");
      const peer = await createAuthenticatedAdmin(peerClient, "hosted-peer");

      const access = await provisionInteractiveMcpAccess(
        ownerClient,
        owner.tenantId,
        "hosted-echo",
        {
          baseUrl: mock.baseUrl,
          toolName: "echo",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
          },
        },
      );

      const handle = `hosted-${Date.now()}`.slice(0, 32);
      const agent = await ownerClient.api<PublicAgent>("/api/v1/agents", {
        method: "POST",
        tenantId: owner.tenantId,
        body: JSON.stringify({
          handle,
          displayName: "Hosted Agent",
          instructions: "Call the echo tool when asked.",
        }),
      });
      await ownerClient.api(`/api/v1/agents/${agent.data.id}/tools`, {
        method: "PUT",
        tenantId: owner.tenantId,
        body: JSON.stringify({ toolIds: [access.toolId] }),
      });
      await ownerClient.api(`/api/v1/agents/${agent.data.id}/publish`, {
        method: "POST",
        tenantId: owner.tenantId,
      });

      const peerCardUrl = `http://127.0.0.1/agents/peer-hosted/card.json`;
      const knockRes = await a2aJsonRpc(
        peerClient.apiUrl,
        handle,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            peerAgentCardUrl: peerCardUrl,
            message: {
              role: "user",
              parts: [{ kind: "text", text: "knock please" }],
              metadata: {
                intent: "jackline.trust.request",
                peerAgentCardUrl: peerCardUrl,
              },
            },
          },
        },
        {
          Cookie: peerClient.cookieHeader(),
          "X-Jackline-Tenant-Id": peer.tenantId,
        },
      );
      assert.equal(knockRes.status, 200, JSON.stringify(knockRes.json));
      const knockResult = knockRes.json["result"] as {
        knockId: string;
        taskId: string;
        knockSecret: string;
      };

      await ownerClient.api(`/api/v1/knocks/${knockResult.knockId}/approve`, {
        method: "POST",
        tenantId: owner.tenantId,
        body: JSON.stringify({ grantTtlSeconds: 3600 }),
      });

      const tasksGet = await a2aJsonRpc(
        peerClient.apiUrl,
        handle,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tasks/get",
          params: { taskId: knockResult.taskId },
        },
        {
          Cookie: peerClient.cookieHeader(),
          "X-Jackline-Tenant-Id": peer.tenantId,
        },
      );
      const taskPayload = tasksGet.json["result"] as {
        result?: { exchangeToken?: string };
      };

      const exchanged = await peerClient.api<{ token: string }>(
        "/api/v1/trust/exchange",
        {
          method: "POST",
          tenantId: peer.tenantId,
          body: JSON.stringify({
            knockSecret: knockResult.knockSecret,
            exchangeToken: taskPayload.result!.exchangeToken,
          }),
        },
      );

      const toolCall = await a2aJsonRpc(
        peerClient.apiUrl,
        handle,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ kind: "text", text: "please echo" }],
              metadata: {
                intent: "jackline.tool.call",
                tool: {
                  name: access.mcpToolName,
                  arguments: { message: "on-behalf" },
                },
              },
            },
          },
        },
        { Authorization: `Bearer ${exchanged.data.token}` },
      );
      assert.equal(toolCall.status, 200, JSON.stringify(toolCall.json));
      const toolResult = toolCall.json["result"] as {
        state: string;
        result?: { mode?: string; tool?: string; output?: unknown };
      };
      assert.equal(toolResult.state, "completed");
      assert.equal(toolResult.result?.mode, "tool_call");
      assert.equal(toolResult.result?.tool, access.mcpToolName);
      assert.match(String(toolResult.result?.output), /echo:on-behalf/);

      const audit = await ownerClient.api<{
        items: Array<{
          toolName: string;
          outcome: string;
          reason: string | null;
        }>;
      }>("/api/v1/audit-events?limit=20", {
        tenantId: owner.tenantId,
      });
      const peerEvent = audit.data.items.find(
        (event) =>
          event.outcome === "allow" &&
          event.toolName === access.mcpToolName &&
          typeof event.reason === "string" &&
          event.reason.startsWith("a2a.peer") &&
          event.reason.includes(`agent=${handle}`),
      );
      assert.ok(
        peerEvent,
        `expected a2a.peer audit event, got ${JSON.stringify(audit.data.items)}`,
      );
    } finally {
      await mock.stop();
    }
  });
});
