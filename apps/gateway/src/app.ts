import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { db } from "@jackline/db";
import {
  clientIpFromHeaders,
  enforceQuota,
} from "@jackline/quotas";
import {
  ErrorCode,
  getConfig,
  JacklineError,
  mcpOauthIssuerUrl,
  publicApiBaseUrl,
  publicMcpUrl,
  RateLimitedError,
} from "@jackline/shared";
import { requireConnection } from "./lib/auth/requireConnection.js";
import type { GatewayEnv } from "./lib/auth/types.js";
import { createJacklineMcpServer } from "./lib/mcp/createJacklineMcpServer.js";
import { requestMiddleware } from "./lib/observability.js";
import { getQuotaLimiter } from "./lib/quotas.js";

export const app = new Hono<GatewayEnv>();

app.onError((err, c) => {
  if (err instanceof RateLimitedError) {
    c.header("Retry-After", String(err.retryAfterSeconds));
    return c.json(
      { error: { code: err.code, message: err.message } },
      429,
    );
  }
  if (err instanceof JacklineError) {
    const status =
      err.code === ErrorCode.UNAUTHORIZED
        ? 401
        : err.code === ErrorCode.FORBIDDEN
          ? 403
          : err.code === ErrorCode.NOT_FOUND
            ? 404
            : err.code === ErrorCode.BAD_REQUEST
              ? 400
              : 500;
    return c.json({ error: { code: err.code, message: err.message } }, status);
  }
  return c.json(
    { error: { code: ErrorCode.INTERNAL, message: "Internal error" } },
    500,
  );
});

app.use(
  "*",
  requestMiddleware as unknown as MiddlewareHandler<
    GatewayEnv,
    "*",
    {},
    Response
  >,
);

app.get("/health", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true, db: true });
  } catch {
    return c.json({ ok: false, db: false }, 503);
  }
});

function protectedResourceMetadata() {
  const config = getConfig();
  if (config.isErr()) throw config.error;
  const resource = publicMcpUrl(config.value);
  const authorizationServer = mcpOauthIssuerUrl(publicApiBaseUrl(config.value));
  return {
    resource,
    authorization_servers: [authorizationServer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

/** RFC 9728 OAuth Protected Resource Metadata (root). */
app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json(protectedResourceMetadata(), 200);
});

/** Path-aware variant when resource is …/mcp. */
app.get("/.well-known/oauth-protected-resource/mcp", (c) => {
  return c.json(protectedResourceMetadata(), 200);
});

app.use("/mcp", requireConnection);
app.use("/mcp", async (c, next) => {
  const gatewayContext = c.get("gatewayContext");
  await enforceQuota(c, getQuotaLimiter(), "gateway.mcp", [
    `tenant:${gatewayContext.tenantId}`,
    `connection:${gatewayContext.connection.id}`,
    `ip:${clientIpFromHeaders((name) => c.req.header(name))}`,
  ]);
  await next();
});

app.all("/mcp", async (c) => {
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
