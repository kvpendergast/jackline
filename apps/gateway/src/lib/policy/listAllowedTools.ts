import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { getAllowedTools } from "@mesh/policy";
import type { MeshError } from "@mesh/shared";
import {
  loadConnectionToolPermissions,
  type ConnectionToolRecord,
} from "./loadToolPermissions.js";
import { z } from "zod";

export type AllowedMcpTool = {
  /** MCP-facing name (unique among allowed tools for this connection). */
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  /** Internal Mesh tool id for later tools/call. */
  toolId: string;
  serverId: string;
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Prefer bare tool name when unique; otherwise `serverName__toolName`. */
export function mcpToolName(
  tool: Pick<ConnectionToolRecord, "name" | "serverName">,
  allowed: Pick<ConnectionToolRecord, "name">[],
): string {
  const collisions = allowed.filter((t) => t.name === tool.name).length;
  if (collisions <= 1) return tool.name;
  return `${sanitizeSegment(tool.serverName)}__${sanitizeSegment(tool.name)}`;
}

export async function listAllowedMcpTools(
  log: Logger,
  tenantId: string,
  connectionId: string,
): Promise<Result<AllowedMcpTool[], MeshError>> {
  const loaded = await loadConnectionToolPermissions(
    log,
    tenantId,
    connectionId,
  );
  if (loaded.isErr()) return err(loaded.error);

  const allowedIds = getAllowedTools(loaded.value);
  if (allowedIds.isErr()) return err(allowedIds.error);

  const allowedIdSet = new Set(allowedIds.value);
  const byId = new Map<string, ConnectionToolRecord>();
  for (const record of loaded.value) {
    if (!allowedIdSet.has(record.id)) continue;
    if (!byId.has(record.id)) {
      byId.set(record.id, record);
    }
  }

  const allowedRecords = [...byId.values()];
  const mcpTools = allowedRecords.map((tool) => ({
    name: mcpToolName(tool, allowedRecords),
    description: `${tool.serverName}: ${tool.name}`,
    inputSchema: z.object({}),
    toolId: tool.id,
    serverId: tool.serverId,
  }));

  log.info(
    { connectionId, tenantId, toolCount: mcpTools.length },
    "listAllowedMcpTools",
  );

  return ok(mcpTools);
}
