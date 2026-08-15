import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { db } from "@jackline/db";
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
