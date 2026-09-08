import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { err, ok, type Result } from "neverthrow";
import {
  recordSpanException,
  setSpanAttributes,
  withSpan,
} from "@jackline/observability";
import type { AuditOutcome, JacklineError } from "@jackline/shared";
import { writeAuditEvent } from "../audit/writeAuditEvent.js";
import type { GatewayConnectionContext } from "../auth/types.js";
import { otelConfig } from "../observability.js";
import { listAllowedMcpTools } from "../policy/listAllowedTools.js";
import { proxyToolCall } from "./proxyToolCall.js";

function outcomeFromProxyError(error: JacklineError): AuditOutcome {
  if (error.code === "BAD_REQUEST" || error.code === "FORBIDDEN") {
    return "deny";
  }
  return "allow_upstream_error";
}

function spanOutcomeFromAudit(outcome: AuditOutcome): "success" | "deny" | "error" {
  if (outcome === "allow") return "success";
  if (outcome === "deny") return "deny";
  return "error";
}

export async function createJacklineMcpServer(
  ctx: GatewayConnectionContext,
): Promise<Result<McpServer, JacklineError>> {
  const server = new McpServer({ name: "jackline", version: "0.0.0" });

  const result = await listAllowedMcpTools(
    ctx.log,
    ctx.tenantId,
    ctx.connection.id,
    ctx.connection.userId,
  );
  if (result.isErr()) {
    return err(result.error);
  }

  for (const tool of result.value) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        return withSpan(otelConfig, {
          name: "jackline.tool.call",
          tracerName: "jackline-gateway",
          attributes: {
            "jackline.tool.name": tool.name,
            "jackline.tool.id": tool.toolId,
            "jackline.server.id": tool.serverId,
            "jackline.tenant.id": ctx.tenantId,
            "jackline.connection.id": ctx.connection.id,
          },
          fn: async () => {
            const started = Date.now();
            const requestArgs = args as Record<string, unknown>;
            const proxied = await proxyToolCall(ctx, tool, requestArgs);
            const latencyMs = Date.now() - started;

            if (proxied.isErr()) {
              const auditOutcome = outcomeFromProxyError(proxied.error);
              setSpanAttributes({
                "jackline.tool.outcome": spanOutcomeFromAudit(auditOutcome),
                "jackline.error_code": proxied.error.code,
              });
              if (auditOutcome !== "deny") {
                recordSpanException(proxied.error);
              }

              await writeAuditEvent(ctx.log, {
                tenantId: ctx.tenantId,
                connectionId: ctx.connection.id,
                clientId: ctx.connection.clientId,
                userId: ctx.connection.userId,
                toolId: tool.toolId,
                toolName: tool.name,
                serverId: tool.serverId,
                outcome: auditOutcome,
                reason: proxied.error.message,
                requestId: ctx.requestId,
                latencyMs,
                requestArgs,
                responseBody: {
                  isError: true,
                  message: proxied.error.message,
                  code: proxied.error.code,
                },
              });
              return {
                content: [{ type: "text", text: proxied.error.message }],
                isError: true,
              };
            }

            setSpanAttributes({ "jackline.tool.outcome": "success" });

            await writeAuditEvent(ctx.log, {
              tenantId: ctx.tenantId,
              connectionId: ctx.connection.id,
              clientId: ctx.connection.clientId,
              userId: ctx.connection.userId,
              toolId: tool.toolId,
              toolName: tool.name,
              serverId: tool.serverId,
              outcome: "allow",
              reason: null,
              requestId: ctx.requestId,
              latencyMs,
              requestArgs,
              responseBody: proxied.value,
            });

            return proxied.value;
          },
        });
      },
    );
  }

  return ok(server);
}
