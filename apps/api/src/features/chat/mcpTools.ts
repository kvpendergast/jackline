import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { toolDefinition } from "@tanstack/ai";
import { JacklineError, SetupError } from "@jackline/shared";

const passthroughArgs = z.object({}).passthrough();

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
    const listed = await client.listTools();
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
            : "Tool failed";
          throw new Error(text);
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
