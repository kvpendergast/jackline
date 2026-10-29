import { createServer, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export type MockUpstream = {
  baseUrl: string;
  /** Upstream tool name Jackline will call (must match the Jackline tools.name). */
  toolName: string;
  stop: () => Promise<void>;
};

/**
 * Minimal Streamable-HTTP MCP server for gateway tools/call integration tests.
 * Mirrors the gateway's per-request transport pattern (stateless JSON responses).
 */
export async function startMockUpstreamMcp(toolName = "echo"): Promise<MockUpstream> {
  const httpServer: Server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);

      const host = req.headers.host ?? "127.0.0.1";
      const url = `http://${host}${req.url ?? "/"}`;
      const method = req.method ?? "GET";
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, value);
        }
      }

      const requestInit: RequestInit = {
        method,
        headers,
      };
      if (method !== "GET" && method !== "HEAD" && body.length > 0) {
        requestInit.body = body;
      }
      const request = new Request(url, requestInit);

      const mcp = new McpServer({
        name: "integration-mock-upstream",
        version: "0.0.0",
      });
      mcp.registerTool(
        toolName,
        {
          description: "Integration mock echo tool",
          inputSchema: {
            message: z.string().optional(),
          },
        },
        async ({ message }) => ({
          content: [
            {
              type: "text",
              text: message ? `echo:${message}` : "echo:ok",
            },
          ],
        }),
      );

      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      try {
        const response = await transport.handleRequest(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const payload = Buffer.from(await response.arrayBuffer());
        res.end(payload);
      } finally {
        await mcp.close().catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: message }));
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (address == null || typeof address === "string") {
        reject(new Error("failed to bind mock upstream"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/mcp`,
    toolName,
    stop: async () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
