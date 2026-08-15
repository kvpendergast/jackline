import { formatMcpToolName } from "@jackline/shared";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import { getAllowedTools } from "@jackline/policy";
import type { JacklineError } from "@jackline/shared";
import {
  loadConnectionToolPermissions,
  type ConnectionToolRecord,
} from "./loadToolPermissions.js";
import { z } from "zod";
import {
  fetchUpstreamToolMetaByServer,
  type UpstreamToolMeta,
} from "../mcp/fetchUpstreamToolSchemas.js";
import {
  jsonSchemaToZod,
  passthroughArgsSchema,
} from "../mcp/jsonSchemaToZod.js";

export type AllowedMcpTool = {
  /** MCP-facing name (unique among allowed tools for this connection). */
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** Internal Jackline tool id for later tools/call. */
  toolId: string;
  serverId: string;
};

/** Always `serverName__toolName` so clients can distinguish shared upstream names. */
export function mcpToolName(
  tool: Pick<ConnectionToolRecord, "name" | "serverName">,
): string {
  return formatMcpToolName(tool.serverName, tool.name);
}

function descriptionFor(
  tool: ConnectionToolRecord,
  meta: UpstreamToolMeta | undefined,
): string {
  if (tool.description?.trim()) return tool.description.trim();
  if (meta?.description?.trim()) return meta.description.trim();
  return `${tool.serverName}: ${tool.name}`;
}

function schemaFor(
  tool: ConnectionToolRecord,
  meta: UpstreamToolMeta | undefined,
): z.ZodType {
  if (tool.inputSchema) return jsonSchemaToZod(tool.inputSchema);
  if (meta?.inputSchema) return jsonSchemaToZod(meta.inputSchema);
  return passthroughArgsSchema;
}

export async function listAllowedMcpTools(
  log: Logger,
  tenantId: string,
  connectionId: string,
  userId: string,
): Promise<Result<AllowedMcpTool[], JacklineError>> {
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

  // Only hit upstream for tools missing a stored schema (pre-sync catalog).
  const needsUpstream = allowedRecords
    .filter((t) => !t.inputSchema)
    .map((t) => t.serverId);

  const metaByServer =
    needsUpstream.length > 0
      ? await fetchUpstreamToolMetaByServer(
          log,
          tenantId,
          userId,
          needsUpstream,
        )
      : new Map<string, Map<string, UpstreamToolMeta>>();

  const mcpTools = allowedRecords.map((tool) => {
    const meta = metaByServer.get(tool.serverId)?.get(tool.name);
    return {
      name: mcpToolName(tool),
      description: descriptionFor(tool, meta),
      inputSchema: schemaFor(tool, meta),
      toolId: tool.id,
      serverId: tool.serverId,
    };
  });

  log.info(
    {
      connectionId,
      tenantId,
      toolCount: mcpTools.length,
      storedSchemas: allowedRecords.filter((t) => t.inputSchema).length,
    },
    "listAllowedMcpTools",
  );

  return ok(mcpTools);
}
