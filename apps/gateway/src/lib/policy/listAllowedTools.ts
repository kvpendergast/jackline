import {
  appendAccountDescription,
  formatMcpToolName,
  injectAccountJsonSchema,
  listAccountsToolName,
  type UpstreamAccountRef,
} from "@jackline/shared";
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
import { listUpstreamAccountsByServer } from "../mcp/upstreamAccounts.js";
import {
  jsonSchemaToZod,
  passthroughArgsSchema,
} from "../mcp/jsonSchemaToZod.js";

export type AllowedMcpTool = {
  /** MCP-facing name (unique among allowed tools for this connection). */
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** Internal Jackline tool id for later tools/call. Empty for synthetic tools. */
  toolId: string;
  serverId: string;
  synthetic?: "list_accounts";
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
  accounts: UpstreamAccountRef[],
): string {
  const base = tool.description?.trim()
    ? tool.description.trim()
    : meta?.description?.trim()
      ? meta.description.trim()
      : `${tool.serverName}: ${tool.name}`;
  return appendAccountDescription(base, accounts);
}

function schemaFor(
  tool: ConnectionToolRecord,
  meta: UpstreamToolMeta | undefined,
  accounts: UpstreamAccountRef[],
): z.ZodType {
  const raw = tool.inputSchema ?? meta?.inputSchema ?? null;
  const injected = injectAccountJsonSchema(raw, accounts);
  if (injected && typeof injected === "object") return jsonSchemaToZod(injected);
  if (accounts.length >= 2) {
    return jsonSchemaToZod(injectAccountJsonSchema({ type: "object", properties: {} }, accounts));
  }
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

  const accountsByServer = await listUpstreamAccountsByServer(
    tenantId,
    userId,
    [...new Set(allowedRecords.map((tool) => tool.serverId))],
  );

  const mcpTools: AllowedMcpTool[] = allowedRecords.map((tool) => {
    const meta = metaByServer.get(tool.serverId)?.get(tool.name);
    const accounts = accountsByServer.get(tool.serverId) ?? [];
    return {
      name: mcpToolName(tool),
      description: descriptionFor(tool, meta, accounts),
      inputSchema: schemaFor(tool, meta, accounts),
      toolId: tool.id,
      serverId: tool.serverId,
    };
  });

  const serversWithChoice = new Map<string, string>();
  for (const tool of allowedRecords) {
    if ((accountsByServer.get(tool.serverId) ?? []).length >= 2) {
      serversWithChoice.set(tool.serverId, tool.serverName);
    }
  }
  for (const [serverId, serverName] of serversWithChoice) {
    const accounts = accountsByServer.get(serverId) ?? [];
    mcpTools.push({
      name: listAccountsToolName(serverName),
      description: appendAccountDescription(
        `List the accounts connected to ${serverName}. Use a label or email as the account argument on other ${serverName} tools.`,
        accounts,
      ),
      inputSchema: z.object({}),
      toolId: "",
      serverId,
      synthetic: "list_accounts",
    });
  }

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
