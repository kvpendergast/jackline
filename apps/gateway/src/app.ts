import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { db } from "@jackline/db";
import {
  getConfig,
  publicApiBaseUrl,
  publicMcpUrl,
} from "@jackline/shared";
import { requireConnection } from "./lib/auth/requireConnection.js";
import type { GatewayEnv } from "./lib/auth/types.js";
import { createJacklineMcpServer } from "./lib/mcp/createJacklineMcpServer.js";

export const app = new Hono<GatewayEnv>();

app.get("/health", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, db: true });
  } catch {
    return c.json({ ok: false, db: false }, 503);
  }
});

/**
 * RFC 9728 Protected Resource Metadata for MCP.
 * Points MCP hosts at the Jackline Authorization Server (API origin).
 */
app.get("/.well-known/oauth-protected-resource", (c) => {
  const config = getConfig();
  if (config.isErr()) {
    return c.json({ error: "misconfigured" }, 500);
  }
  const env = config.value;
  const mcp = publicMcpUrl(env);
  const api = publicApiBaseUrl(env);
  return c.json({
    resource: mcp,
    authorization_servers: [api],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  });
});

app.all("/mcp", requireConnection, async (c) => {
  const gatewayContext = c.get("gatewayContext");
  const serverResult = await createJacklineMcpServer(gatewayContext);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  if (serverResult.isErr()) {
    throw serverResult.error;
  }

  const server = serverResult.value;

  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close().catch(() => undefined);
  }
});
