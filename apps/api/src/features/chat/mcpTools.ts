import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { toolDefinition } from "@tanstack/ai";
import { JacklineError, SetupError } from "@jackline/shared";

const passthroughArgs = z.object({}).passthrough();

export function policyDeniedMessage(toolName: string, detail: string): string {
  const trimmed = detail.trim();
  if (
    trimmed &&
    /denied|forbidden|not allowed|policy/i.test(trimmed) &&
    trimmed.includes(toolName)
  ) {
    return trimmed;
  }
  return trimmed
    ? `policy denied \`${toolName}\`: ${trimmed}`
    : `policy denied \`${toolName}\``;
}

function inputSchemaFor(schema: unknown): z.ZodType {
  if (schema == null || typeof schema !== "object") return passthroughArgs;
  try {
    return z.fromJSONSchema(schema as Record<string, unknown>, {
      defaultTarget: "draft-7",
    });
  } catch {
    return passthroughArgs;
  }
}

export type ConnectedJacklineMcp = {
  tools: unknown[];
  close: () => Promise<void>;
};

export function isMcpMethodNotFound(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("-32601") || /method not found/i.test(message);
}

export async function connectJacklineMcpTools(
  mcpUrl: string,
  gatewayToken: string,
): Promise<Result<ConnectedJacklineMcp, JacklineError>> {
  const client = new Client({ name: "jackline-chat", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
      },
    },
  });

  try {
    await client.connect(transport as unknown as Transport);
    let listed: { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    try {
      listed = await client.listTools();
    } catch (cause) {
      // Jackline registers tools/list only after at least one tool is granted.
      if (isMcpMethodNotFound(cause)) {
        listed = { tools: [] };
      } else {
        throw cause;
      }
    }
    const tools = listed.tools.map((tool) => {
      const def = toolDefinition({
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: inputSchemaFor(tool.inputSchema),
      });
      return def.server(async (input) => {
        const result = await client.callTool({
          name: tool.name,
          arguments: input as Record<string, unknown>,
        });
        if (result.isError) {
          const text = Array.isArray(result.content)
            ? result.content
                .map((part) =>
                  part.type === "text" ? part.text : JSON.stringify(part),
                )
                .join("\n")
            : "";
          throw new Error(policyDeniedMessage(tool.name, text));
        }
        if (result.structuredContent != null) {
          return result.structuredContent;
        }
        return result.content;
      });
    });

    return ok({
      tools,
      close: async () => {
        await client.close().catch(() => undefined);
      },
    });
  } catch (cause) {
    await client.close().catch(() => undefined);
    const message =
      cause instanceof Error ? cause.message : "Failed to connect to Jackline MCP";
    return err(new SetupError(message));
  }
}
