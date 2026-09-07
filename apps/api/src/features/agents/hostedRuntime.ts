import { chat, maxIterations, streamToText } from "@tanstack/ai";
import { and, eq, inArray } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  agentToolBindings,
  a2aTasks,
  connectionToolOverrides,
  connections,
  db,
  servers,
  tools,
  type Agent as AgentRow,
} from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  getConfig,
  internalMcpUrl,
  JacklineError,
  SetupError,
} from "@jackline/shared";
import { createChatAdapter } from "../chat/adapter.js";
import { ensureJacklineChatConnection } from "../chat/ensure.js";
import { connectJacklineMcpTools } from "../chat/mcpTools.js";
import { chatServices } from "../chat/service.js";
import { otelConfig } from "../../lib/observability.js";
import {
  extractPeerMessageText,
  extractToolCallRequest,
  type PeerToolCallRequest,
} from "./a2aProtocol.js";
import {
  resolveBoundToolName,
  toBoundAgentTool,
  type BoundAgentTool,
} from "./boundTools.js";

export type { BoundAgentTool } from "./boundTools.js";
export { resolveBoundToolName } from "./boundTools.js";

export async function listBoundAgentTools(
  agentId: string,
): Promise<Result<BoundAgentTool[], JacklineError>> {
  const rows = await db
    .select({
      toolId: tools.id,
      name: tools.name,
      description: tools.description,
      serverId: tools.serverId,
      serverName: servers.name,
    })
    .from(agentToolBindings)
    .innerJoin(tools, eq(agentToolBindings.toolId, tools.id))
    .innerJoin(servers, eq(tools.serverId, servers.id))
    .where(eq(agentToolBindings.agentId, agentId));

  return ok(
    rows.map((row) =>
      toBoundAgentTool({
        toolId: row.toolId,
        name: row.name,
        description: row.description ?? null,
        serverId: row.serverId,
        serverName: row.serverName,
      }),
    ),
  );
}

/**
 * Ensure the owner's Jackline Chat connection can call the agent's bound tools.
 * Agent bindings are the source of truth; chat connection overrides carry gateway policy.
 */
export async function syncAgentToolsToOwnerChatConnection(
  log: Logger,
  tenantId: string,
  ownerUserId: string,
  toolIds: string[],
): Promise<Result<{ connectionId: string }, JacklineError>> {
  const binding = await ensureJacklineChatConnection(log, tenantId, ownerUserId);
  if (binding.isErr()) return err(binding.error);
  const connectionId = binding.value.connection.id;
  const uniqueToolIds = [...new Set(toolIds)];

  await db.transaction(async (tx) => {
    await tx
      .delete(connectionToolOverrides)
      .where(
        and(
          eq(connectionToolOverrides.connectionId, connectionId),
          eq(connectionToolOverrides.tenantId, tenantId),
        ),
      );

    if (uniqueToolIds.length > 0) {
      await tx.insert(connectionToolOverrides).values(
        uniqueToolIds.map((toolId) => ({
          tenantId,
          connectionId,
          toolId,
          type: "allow" as const,
        })),
      );
    }

    await tx
      .update(connections)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)),
      );
  });

  log.info(
    { tenantId, connectionId, toolCount: uniqueToolIds.length },
    "agents.syncAgentToolsToOwnerChatConnection",
  );
  return ok({ connectionId });
}

async function callBoundToolViaGateway(input: {
  mcpUrl: string;
  gatewayToken: string;
  mcpName: string;
  args: Record<string, unknown>;
  requestId?: string;
}): Promise<Result<unknown, JacklineError>> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const { injectOutboundHeaders } = await import("@jackline/observability");

  const client = new Client({ name: "jackline-agent", version: "0.0.0" });
  const headers = injectOutboundHeaders(otelConfig, {
    requestId: input.requestId,
    headers: { Authorization: `Bearer ${input.gatewayToken}` },
  });
  const transport = new StreamableHTTPClientTransport(new URL(input.mcpUrl), {
    requestInit: { headers },
  });

  try {
    await client.connect(transport as never);
    const result = await client.callTool({
      name: input.mcpName,
      arguments: input.args,
    });
    await client.close().catch(() => undefined);
    if (result.isError) {
      const text = Array.isArray(result.content)
        ? result.content
            .map((part) =>
              part.type === "text" ? part.text : JSON.stringify(part),
            )
            .join("\n")
        : "tool call failed";
      return err(new ForbiddenError(text || "Tool call denied"));
    }
    if (result.structuredContent != null) return ok(result.structuredContent);
    if (Array.isArray(result.content)) {
      const text = result.content
        .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
        .join("\n");
      return ok(text);
    }
    return ok(result.content ?? null);
  } catch (cause) {
    await client.close().catch(() => undefined);
    const message =
      cause instanceof Error ? cause.message : "Failed to call agent tool";
    return err(new SetupError(message));
  }
}

async function runLlmHostedTurn(input: {
  agent: AgentRow;
  peerText: string;
  bound: BoundAgentTool[];
  mcpUrl: string;
  gatewayToken: string;
  requestId?: string;
  log: Logger;
}): Promise<Result<{ text: string; toolNames: string[] }, JacklineError>> {
  const resolved = await chatServices.resolveRun(
    input.log,
    input.agent.tenantId,
    input.agent.ownerUserId,
  );
  if (resolved.isErr()) return err(resolved.error);

  const adapterResult = createChatAdapter(resolved.value.adapterInput);
  if (adapterResult.isErr()) return err(adapterResult.error);

  const allowed = new Set(input.bound.map((tool) => tool.mcpName));
  const mcp = await connectJacklineMcpTools(input.mcpUrl, input.gatewayToken, {
    requestId: input.requestId,
    otel: otelConfig,
    allowedToolNames: allowed,
  });
  if (mcp.isErr()) return err(mcp.error);

  const instructions =
    input.agent.instructions?.trim() ||
    "You are a helpful agent. Use the available tools when needed.";

  try {
    const stream = chat({
      adapter: adapterResult.value as never,
      systemPrompts: [instructions],
      messages: [{ role: "user", content: input.peerText }] as never,
      tools: mcp.value.tools as never,
      agentLoopStrategy: maxIterations(6),
    });
    const text = await streamToText(stream);
    return ok({ text, toolNames: [...allowed] });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Hosted agent run failed";
    return err(new SetupError(message));
  } finally {
    await mcp.value.close().catch(() => undefined);
  }
}

export async function runHostedPeerMessage(input: {
  agent: AgentRow;
  trustGrantId: string;
  params: Record<string, unknown> | undefined;
  rpcId: string | number | null;
  log: Logger;
  requestId?: string;
}): Promise<Result<{ id: string | number | null; result: unknown }, JacklineError>> {
  const toolCallResult = extractToolCallRequest(input.params);
  if (toolCallResult.isErr()) return err(toolCallResult.error);

  const textResult = extractPeerMessageText(input.params);
  if (textResult.isErr() && !toolCallResult.value) {
    return err(textResult.error);
  }
  const peerText = textResult.isOk() ? textResult.value : "";

  const boundResult = await listBoundAgentTools(input.agent.id);
  if (boundResult.isErr()) return err(boundResult.error);
  const bound = boundResult.value;

  const sync = await syncAgentToolsToOwnerChatConnection(
    input.log,
    input.agent.tenantId,
    input.agent.ownerUserId,
    bound.map((tool) => tool.toolId),
  );
  if (sync.isErr()) return err(sync.error);

  const chatBinding = await ensureJacklineChatConnection(
    input.log,
    input.agent.tenantId,
    input.agent.ownerUserId,
  );
  if (chatBinding.isErr()) return err(chatBinding.error);

  const configResult = getConfig();
  if (configResult.isErr()) return err(configResult.error);
  const mcpUrl = internalMcpUrl(configResult.value);
  const gatewayToken = chatBinding.value.gatewayToken;

  const [task] = await db
    .insert(a2aTasks)
    .values({
      agentId: input.agent.id,
      tenantId: input.agent.tenantId,
      trustGrantId: input.trustGrantId,
      state: "working",
      method: "message/send",
      params: input.params ?? {},
    })
    .returning();
  if (!task) return err(new SetupError("Failed to create A2A task"));

  try {
    let resultPayload: Record<string, unknown>;

    if (toolCallResult.value) {
      const requested: PeerToolCallRequest = toolCallResult.value;
      const match = resolveBoundToolName(bound, requested.name);
      if (!match) {
        throw new ForbiddenError(
          `Tool \`${requested.name}\` is not bound to this agent`,
        );
      }
      const call = await callBoundToolViaGateway({
        mcpUrl,
        gatewayToken,
        mcpName: match.mcpName,
        args: requested.arguments,
        ...(input.requestId !== undefined
          ? { requestId: input.requestId }
          : {}),
      });
      if (call.isErr()) throw call.error;
      resultPayload = {
        mode: "tool_call",
        tool: match.mcpName,
        output: call.value,
        ...(peerText ? { message: peerText } : {}),
      };
    } else {
      if (bound.length === 0) {
        resultPayload = {
          mode: "message",
          message:
            peerText ||
            "No tools are bound to this agent; nothing to execute.",
        };
      } else {
        const llm = await runLlmHostedTurn({
          agent: input.agent,
          peerText,
          bound,
          mcpUrl,
          gatewayToken,
          ...(input.requestId !== undefined
            ? { requestId: input.requestId }
            : {}),
          log: input.log,
        });
        if (llm.isErr()) throw llm.error;
        resultPayload = {
          mode: "llm",
          message: llm.value.text,
          availableTools: llm.value.toolNames,
        };
      }
    }

    await db
      .update(a2aTasks)
      .set({
        state: "completed",
        result: resultPayload,
        updatedAt: new Date(),
      })
      .where(eq(a2aTasks.id, task.id));

    return ok({
      id: input.rpcId,
      result: {
        taskId: task.id,
        state: "completed",
        result: resultPayload,
      },
    });
  } catch (cause) {
    const message =
      cause instanceof JacklineError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "Hosted agent run failed";
    const code =
      cause instanceof JacklineError ? cause.code : "SETUP_ERROR";

    await db
      .update(a2aTasks)
      .set({
        state: "failed",
        error: { message, code },
        updatedAt: new Date(),
      })
      .where(eq(a2aTasks.id, task.id));

    if (cause instanceof JacklineError) return err(cause);
    return err(new SetupError(message));
  }
}

/** Used by setTools to keep owner chat connection in sync with agent bindings. */
export async function assertToolsExistInTenant(
  tenantId: string,
  toolIds: string[],
): Promise<Result<string[], JacklineError>> {
  const unique = [...new Set(toolIds)];
  if (unique.length === 0) return ok([]);
  const found = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.tenantId, tenantId), inArray(tools.id, unique)));
  if (found.length !== unique.length) {
    return err(
      new BadRequestError(
        "One or more toolIds do not reference tools in this tenant",
      ),
    );
  }
  return ok(unique);
}
