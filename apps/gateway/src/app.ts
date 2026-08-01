import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireConnection } from "./lib/auth/requireConnection.js";
import type { GatewayEnv } from "./lib/auth/types.js";
import { createMeshMcpServer } from "./lib/mcp/createMeshMcpServer.js";

export const app = new Hono<GatewayEnv>();

app.get("/health", (c) => c.json({ ok: true }));

app.all("/mcp", requireConnection, async (c) => {
  const gatewayContext = c.get("gatewayContext");
  const serverResult = await createMeshMcpServer(gatewayContext);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  if (serverResult.isErr()) {
    throw serverResult.error
  }

  const server = serverResult.value;

  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close().catch(() => undefined);
  }
});
