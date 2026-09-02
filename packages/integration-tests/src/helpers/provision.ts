import { formatMcpToolName } from "@jackline/shared";
import type { ApiClient } from "./client.js";

export type InteractiveMcpAccess = {
  connectionId: string;
  gatewayToken: string;
  /** Jackline tools.name (also the upstream tools/call name). */
  toolName: string;
  /** MCP-facing name advertised by the gateway (`serverName__toolName`). */
  mcpToolName: string;
  serverName: string;
  toolId: string;
};

export type ProvisionInteractiveMcpOptions = {
  baseUrl?: string;
  toolName?: string;
  inputSchema?: Record<string, unknown> | null;
  /** Attach grant + deny roles for the same tool (deny-wins). */
  alsoDeny?: boolean;
  /** Attach only a deny role (no grant). */
  denyOnly?: boolean;
};

/** Provisions server → tool → role → client → connection → credential for MCP gateway tests. */
export async function provisionInteractiveMcpAccess(
  client: ApiClient,
  tenantId: string,
  label: string,
  options: ProvisionInteractiveMcpOptions = {},
): Promise<InteractiveMcpAccess> {
  const suffix = `${label}-${Date.now()}`;
  const toolName = options.toolName ?? `${label}/echo`;
  const serverName = `integration-server-${suffix}`;
  const baseUrl = options.baseUrl ?? "https://example.com/mcp";

  const server = await client.api<{ id: string; name: string }>(
    "/api/v1/servers",
    {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: serverName,
        baseUrl,
        authMethod: "api_key",
        kind: "mcp",
      }),
    },
  );

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
      ...(options.inputSchema !== undefined
        ? { inputSchema: options.inputSchema }
        : {}),
    }),
  });

  const roleIds: string[] = [];

  if (!options.denyOnly) {
    const grant = await client.api<{ id: string }>("/api/v1/roles", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: `integration-grant-${suffix}`,
        type: "grant",
      }),
    });
    await client.api(`/api/v1/roles/${grant.data.id}/tools`, {
      method: "PUT",
      tenantId,
      body: JSON.stringify({ toolIds: [tool.data.id] }),
    });
    roleIds.push(grant.data.id);
  }

  if (options.alsoDeny || options.denyOnly) {
    const deny = await client.api<{ id: string }>("/api/v1/roles", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: `integration-deny-${suffix}`,
        type: "deny",
      }),
    });
    await client.api(`/api/v1/roles/${deny.data.id}/tools`, {
      method: "PUT",
      tenantId,
      body: JSON.stringify({ toolIds: [tool.data.id] }),
    });
    roleIds.push(deny.data.id);
  }

  if (roleIds.length === 0) {
    throw new Error("provisionInteractiveMcpAccess requires at least one role");
  }

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

  for (const roleId of roleIds) {
    await client.api(`/api/v1/connections/${connection.data.id}/roles`, {
      method: "POST",
      tenantId,
      body: JSON.stringify({ roleId }),
    });
  }

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
    mcpToolName: formatMcpToolName(server.data.name, tool.data.name),
    serverName: server.data.name,
    toolId: tool.data.id,
  };
}
