import type { ApiClient } from "./client.js";

export type InteractiveMcpAccess = {
  connectionId: string;
  gatewayToken: string;
  toolName: string;
};

/** Provisions server → tool → role → client → connection → credential for MCP gateway tests. */
export async function provisionInteractiveMcpAccess(
  client: ApiClient,
  tenantId: string,
  label: string,
): Promise<InteractiveMcpAccess> {
  const suffix = `${label}-${Date.now()}`;
  const toolName = `${label}/echo`;

  const server = await client.api<{ id: string }>("/api/v1/servers", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: `integration-server-${suffix}`,
      baseUrl: "https://example.com/mcp",
      authMethod: "api_key",
      kind: "mcp",
    }),
  });

  await client.api(`/api/v1/servers/${server.data.id}`, {
    method: "PATCH",
    tenantId,
    body: JSON.stringify({ status: "active" }),
  });

  const tool = await client.api<{ id: string; name: string }>("/api/v1/tools", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: toolName,
      serverId: server.data.id,
      status: "active",
    }),
  });

  const role = await client.api<{ id: string }>("/api/v1/roles", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: `integration-grant-${suffix}`,
      type: "grant",
    }),
  });

  await client.api(`/api/v1/roles/${role.data.id}/tools`, {
    method: "PUT",
    tenantId,
    body: JSON.stringify({ toolIds: [tool.data.id] }),
  });

  const mcpClient = await client.api<{ id: string }>("/api/v1/clients", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: `integration-client-${suffix}`,
      kind: "interactive",
    }),
  });

  const users = await client.api<{ items: { id: string }[] }>(
    "/api/v1/users?limit=50",
    { tenantId },
  );
  const userId = users.data.items[0]?.id;
  if (!userId) throw new Error("no tenant user for connection subject");

  const connection = await client.api<{ id: string }>("/api/v1/connections", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      clientId: mcpClient.data.id,
      userId,
    }),
  });

  await client.api(`/api/v1/connections/${connection.data.id}/roles`, {
    method: "POST",
    tenantId,
    body: JSON.stringify({ roleId: role.data.id }),
  });

  await client.api(`/api/v1/connections/${connection.data.id}`, {
    method: "PATCH",
    tenantId,
    body: JSON.stringify({ status: "active" }),
  });

  await client.api("/api/v1/secrets", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      kind: "api_key",
      name: `integration-upstream-${suffix}`,
      value: "not-a-real-key",
      serverId: server.data.id,
    }),
  });

  const minted = await client.api<{ token: string }>(
    `/api/v1/connections/${connection.data.id}/credentials`,
    { method: "POST", tenantId, body: "{}" },
  );

  return {
    connectionId: connection.data.id,
    gatewayToken: minted.data.token,
    toolName: tool.data.name,
  };
}
