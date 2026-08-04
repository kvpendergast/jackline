import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { getAllowedTools, type ToolPermission } from "@mesh/policy";
import {
  connectionRoles,
  connectionToolOverrides,
  connections,
  db,
  roleTools,
  roles,
  servers,
  tools,
} from "@mesh/db";
import {
  formatMcpToolName,
  MeshError,
  NotFoundError,
  type PublicEffectiveTool,
} from "@mesh/shared";

type SourceRow = ToolPermission & {
  name: string;
  serverId: string;
  serverName: string;
  source: PublicEffectiveTool["sources"][number];
};

/**
 * Resolve effective tools for a connection with source attribution.
 * Deny wins across roles/overrides; `allowed` requires active tool + server + allow.
 */
export async function listEffectiveTools(
  log: Logger,
  tenantId: string,
  connectionId: string,
): Promise<Result<PublicEffectiveTool[], MeshError>> {
  const [conn] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)),
    )
    .limit(1);

  if (!conn) {
    return err(new NotFoundError("Connection not found"));
  }

  const roleRows = await db
    .select({
      id: tools.id,
      name: tools.name,
      status: tools.status,
      serverId: servers.id,
      serverName: servers.name,
      serverStatus: servers.status,
      roleId: roles.id,
      roleName: roles.name,
      roleType: roles.type,
    })
    .from(connectionRoles)
    .innerJoin(
      roles,
      and(
        eq(roles.id, connectionRoles.roleId),
        eq(roles.tenantId, connectionRoles.tenantId),
      ),
    )
    .innerJoin(
      roleTools,
      and(
        eq(roleTools.roleId, roles.id),
        eq(roleTools.tenantId, roles.tenantId),
      ),
    )
    .innerJoin(
      tools,
      and(eq(tools.id, roleTools.toolId), eq(tools.tenantId, roleTools.tenantId)),
    )
    .innerJoin(
      servers,
      and(eq(servers.id, tools.serverId), eq(servers.tenantId, tools.tenantId)),
    )
    .where(
      and(
        eq(connectionRoles.connectionId, connectionId),
        eq(connectionRoles.tenantId, tenantId),
      ),
    );

  const overrideRows = await db
    .select({
      id: tools.id,
      name: tools.name,
      status: tools.status,
      serverId: servers.id,
      serverName: servers.name,
      serverStatus: servers.status,
      overrideType: connectionToolOverrides.type,
    })
    .from(connectionToolOverrides)
    .innerJoin(
      tools,
      and(
        eq(tools.id, connectionToolOverrides.toolId),
        eq(tools.tenantId, connectionToolOverrides.tenantId),
      ),
    )
    .innerJoin(
      servers,
      and(eq(servers.id, tools.serverId), eq(servers.tenantId, tools.tenantId)),
    )
    .where(
      and(
        eq(connectionToolOverrides.connectionId, connectionId),
        eq(connectionToolOverrides.tenantId, tenantId),
      ),
    );

  const sourceRows: SourceRow[] = [
    ...roleRows.map((row) => {
      const permission = (
        row.roleType === "grant" ? "allow" : "deny"
      ) as "allow" | "deny";
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        serverId: row.serverId,
        serverName: row.serverName,
        serverStatus: row.serverStatus,
        permission,
        source: {
          kind: "role" as const,
          roleId: row.roleId,
          roleName: row.roleName,
          roleType: row.roleType as "grant" | "deny",
          permission,
        },
      };
    }),
    ...overrideRows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      serverId: row.serverId,
      serverName: row.serverName,
      serverStatus: row.serverStatus,
      permission: row.overrideType,
      source: {
        kind: "override" as const,
        permission: row.overrideType,
      },
    })),
  ];

  type Acc = {
    toolId: string;
    name: string;
    serverId: string;
    serverName: string;
    toolStatus: SourceRow["status"];
    serverStatus: SourceRow["serverStatus"];
    permission: "allow" | "deny";
    sources: PublicEffectiveTool["sources"];
  };

  const byId = new Map<string, Acc>();
  for (const row of sourceRows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, {
        toolId: row.id,
        name: row.name,
        serverId: row.serverId,
        serverName: row.serverName,
        toolStatus: row.status,
        serverStatus: row.serverStatus,
        permission: row.permission,
        sources: [row.source],
      });
      continue;
    }
    existing.sources.push(row.source);
    if (row.permission === "deny") {
      existing.permission = "deny";
    }
  }

  const permissions: ToolPermission[] = [...byId.values()].map((row) => ({
    id: row.toolId,
    status: row.toolStatus,
    permission: row.permission,
    serverStatus: row.serverStatus,
  }));

  const allowedIds = getAllowedTools(permissions);
  if (allowedIds.isErr()) return err(allowedIds.error);
  const allowedSet = new Set(allowedIds.value);

  const items: PublicEffectiveTool[] = [...byId.values()]
    .map((row) => ({
      toolId: row.toolId,
      name: row.name,
      mcpName: formatMcpToolName(row.serverName, row.name),
      serverId: row.serverId,
      serverName: row.serverName,
      toolStatus: row.toolStatus,
      serverStatus: row.serverStatus,
      permission: row.permission,
      allowed: allowedSet.has(row.toolId),
      sources: row.sources,
    }))
    .sort((a, b) => {
      if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
      return a.mcpName.localeCompare(b.mcpName);
    });

  log.debug(
    { connectionId, tenantId, count: items.length, allowed: allowedSet.size },
    "listEffectiveTools",
  );

  return ok(items);
}
