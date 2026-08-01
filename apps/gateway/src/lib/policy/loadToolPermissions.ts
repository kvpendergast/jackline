import { and, eq } from "drizzle-orm";
import { ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  connectionRoles,
  connectionToolOverrides,
  db,
  roleTools,
  roles,
  servers,
  tools,
} from "@mesh/db";
import type { MeshError } from "@mesh/shared";
import type { ToolPermission } from "@mesh/policy";

export type ConnectionToolRecord = ToolPermission & {
  name: string;
  serverId: string;
  serverName: string;
};

/**
 * Flatten role tools + connection overrides into permission rows for policy.
 * grant roles → allow; deny roles → deny; overrides use their own type.
 */
export async function loadConnectionToolPermissions(
  log: Logger,
  tenantId: string,
  connectionId: string,
): Promise<Result<ConnectionToolRecord[], MeshError>> {
  const roleRows = await db
    .select({
      id: tools.id,
      name: tools.name,
      status: tools.status,
      serverId: servers.id,
      serverName: servers.name,
      serverStatus: servers.status,
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

  const records: ConnectionToolRecord[] = [
    ...roleRows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      serverId: row.serverId,
      serverName: row.serverName,
      serverStatus: row.serverStatus,
      permission: (row.roleType === "grant" ? "allow" : "deny") as
        | "allow"
        | "deny",
    })),
    ...overrideRows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      serverId: row.serverId,
      serverName: row.serverName,
      serverStatus: row.serverStatus,
      permission: row.overrideType,
    })),
  ];

  log.debug(
    {
      connectionId,
      tenantId,
      roleToolCount: roleRows.length,
      overrideCount: overrideRows.length,
    },
    "loadConnectionToolPermissions",
  );

  return ok(records);
}
