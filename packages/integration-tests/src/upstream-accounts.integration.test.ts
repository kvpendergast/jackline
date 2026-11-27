import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, secrets, upstreamAccounts } from "@jackline/db";
import { formatMcpToolName } from "@jackline/shared";
import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

function idToken(email: string, sub: string): string {
  const payload = Buffer.from(JSON.stringify({ email, sub })).toString("base64url");
  return `header.${payload}.sig`;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        reject(new Error("failed to bind"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("upstream accounts", () => {
  const refreshTokens = new Set<string>();
  let tokenUrl = "";
  let mcpUrl = "";
  let stopToken: Server | undefined;
  let stopMcp: Server | undefined;

  after(async () => {
    await new Promise<void>((resolve) => stopToken?.close(() => resolve()));
    await new Promise<void>((resolve) => stopMcp?.close(() => resolve()));
  });

  it("backfills a legacy per-user oauth secret into a default account", async () => {
    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "acct-migrate");
    const server = await client.api<{ id: string }>("/api/v1/servers", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: `legacy-${Date.now()}`,
        baseUrl: "https://example.com/mcp",
        authMethod: "oauth",
        kind: "mcp",
      }),
    });
    const users = await client.api<{ items: { id: string }[] }>(
      "/api/v1/users?limit=20",
      { tenantId },
    );
    const userId = users.data.items[0]?.id;
    assert.ok(userId);

    const [secret] = await db
      .insert(secrets)
      .values({
        kind: "oauth",
        name: "legacy personal oauth",
        ciphertext: Buffer.from([1, 2, 3]),
        nonce: Buffer.from([4, 5, 6]),
        keyVersion: 1,
        serverId: server.data.id,
        userId,
        tenantId,
      })
      .returning({ id: secrets.id });
    assert.ok(secret);

    await db.execute(sql`
      INSERT INTO "upstream_accounts" (
        "id", "label", "is_default", "server_id", "user_id", "tenant_id"
      )
      SELECT gen_random_uuid(), 'Default', true, s."server_id", s."user_id", s."tenant_id"
      FROM "secrets" s
      WHERE s."id" = ${secret.id}
        AND s."upstream_account_id" IS NULL
    `);
    await db.execute(sql`
      UPDATE "secrets" s
      SET "upstream_account_id" = a."id"
      FROM "upstream_accounts" a
      WHERE s."id" = ${secret.id}
        AND a."server_id" = s."server_id"
        AND a."user_id" = s."user_id"
        AND a."label" = 'Default'
        AND a."is_default" = true
    `);

    const [linked] = await db
      .select()
      .from(secrets)
      .where(eq(secrets.id, secret.id))
      .limit(1);
    assert.ok(linked?.upstreamAccountId);
    const [account] = await db
      .select()
      .from(upstreamAccounts)
      .where(eq(upstreamAccounts.id, linked.upstreamAccountId))
      .limit(1);
    assert.equal(account?.label, "Default");
    assert.equal(account?.isDefault, true);
    assert.equal(account?.externalEmail, null);
    assert.equal(linked.ciphertext[0], 1);
  });

  it("connects, refreshes a duplicate, rejects a mismatch, and requires account on tool calls", async () => {
    stopToken = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on("end", () => {
        const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const grant = params.get("grant_type");
        const code = params.get("code") ?? "";
        const refresh = params.get("refresh_token") ?? "";
        if (grant === "refresh_token") refreshTokens.add(refresh);
        const email = refresh.includes("other") || code === "code-other"
          ? "other@example.com"
          : "me@example.com";
        const access = grant === "refresh_token" ? `refreshed-${email}` : `at-${email}`;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            access_token: access,
            refresh_token: `rt-${email}`,
            expires_in: 1,
            token_type: "Bearer",
            id_token: idToken(email, `sub-${email}`),
          }),
        );
      });
    });
    tokenUrl = await listen(stopToken);

    stopMcp = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const requestInit: RequestInit = { method: req.method ?? "GET", headers };
      if (body.length > 0 && req.method !== "GET" && req.method !== "HEAD") {
        requestInit.body = body;
      }
      const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, requestInit);
      const mcp = new McpServer({ name: "acct-mock", version: "0.0.0" });
      mcp.registerTool(
        "echo",
        { description: "echo", inputSchema: { message: z.string().optional() } },
        async ({ message }) => ({
          content: [
            {
              type: "text",
              text: `echo:${message ?? "ok"} auth:${headers.get("authorization") ?? ""}`,
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
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } finally {
        await mcp.close().catch(() => undefined);
      }
    });
    mcpUrl = await listen(stopMcp);

    const client = await createApiClient();
    const { tenantId } = await createAuthenticatedAdmin(client, "acct-oauth");
    const serverName = `gmail-${Date.now()}`;
    const server = await client.api<{ id: string }>("/api/v1/servers", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: serverName,
        baseUrl: mcpUrl,
        authMethod: "oauth",
        kind: "mcp",
        credentialMode: "subject_required",
        oauthAuthorizeUrl: "https://accounts.example.com/o/oauth2/auth",
        oauthTokenUrl: `${tokenUrl}/token`,
        oauthClientId: "client-id",
        oauthScopes: "mail.read",
      }),
    });
    await client.api("/api/v1/secrets", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        kind: "oauth_client",
        name: "oauth client",
        value: "client-secret",
        serverId: server.data.id,
      }),
    });
    await client.api(`/api/v1/servers/${server.data.id}`, {
      method: "PATCH",
      tenantId,
      body: JSON.stringify({ status: "active" }),
    });

    async function callback(code: string, startBody: Record<string, unknown>) {
      const start = await client.api<{ authorizeUrl: string }>("/api/v1/oauth/start", {
        method: "POST",
        tenantId,
        body: JSON.stringify({ serverId: server.data.id, ...startBody }),
      });
      const state = new URL(start.data.authorizeUrl).searchParams.get("state");
      assert.ok(state);
      const res = await fetch(
        `${client.apiUrl}/api/v1/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        { redirect: "manual" },
      );
      return res.headers.get("location") ?? "";
    }

    const created = await callback("code-me", {
      mode: "add",
      label: "Work",
      expectedEmail: "me@example.com",
    });
    assert.match(created, /account_status=created/);
    assert.match(created, /account_email=me%40example.com/);
    assert.match(created, /account_label=Work/);

    const refreshed = await callback("code-me", {
      mode: "add",
      expectedEmail: "me@example.com",
    });
    assert.match(refreshed, /account_status=refreshed/);

    const mismatch = await callback("code-other", {
      mode: "add",
      expectedEmail: "me@example.com",
    });
    assert.match(mismatch, /oauth_error=/);
    assert.match(decodeURIComponent(mismatch), /No account was changed/);

    const listed = await client.api<{
      items: Array<{
        serverId: string;
        accounts: Array<{ id: string; label: string; externalEmail: string | null }>;
      }>;
    }>("/api/v1/me/servers", { tenantId });
    const row = listed.data.items.find((item) => item.serverId === server.data.id);
    assert.equal(row?.accounts.length, 1);
    assert.equal(row?.accounts[0]?.externalEmail, "me@example.com");
    const workId = row?.accounts[0]?.id;
    assert.ok(workId);

    const second = await callback("code-other", { mode: "add", label: "Personal" });
    assert.match(second, /account_status=created/);
    assert.match(second, /other%40example.com/);

    const reconnectClash = await callback("code-other", {
      mode: "reconnect",
      accountId: workId,
    });
    assert.match(decodeURIComponent(reconnectClash), /did not change "Work"/);

    const after = await client.api<{
      items: Array<{ serverId: string; accounts: Array<{ label: string }> }>;
    }>("/api/v1/me/servers", { tenantId });
    const accounts = after.data.items.find((item) => item.serverId === server.data.id)?.accounts ?? [];
    assert.deepEqual(
      accounts.map((account) => account.label).sort(),
      ["Personal", "Work"],
    );

    const tool = await client.api<{ id: string }>("/api/v1/tools", {
      method: "POST",
      tenantId,
      body: JSON.stringify({
        name: "echo",
        serverId: server.data.id,
        status: "active",
        inputSchema: { type: "object", properties: { message: { type: "string" } } },
      }),
    });
    const role = await client.api<{ id: string }>("/api/v1/roles", {
      method: "POST",
      tenantId,
      body: JSON.stringify({ name: `grant-${Date.now()}`, type: "grant" }),
    });
    await client.api(`/api/v1/roles/${role.data.id}/tools`, {
      method: "PUT",
      tenantId,
      body: JSON.stringify({ toolIds: [tool.data.id] }),
    });
    const mcpClient = await client.api<{ id: string }>("/api/v1/clients", {
      method: "POST",
      tenantId,
      body: JSON.stringify({ name: `client-${Date.now()}`, kind: "interactive" }),
    });
    const users = await client.api<{ items: { id: string }[] }>("/api/v1/users?limit=20", {
      tenantId,
    });
    const connection = await client.api<{ id: string }>("/api/v1/connections", {
      method: "POST",
      tenantId,
      body: JSON.stringify({ clientId: mcpClient.data.id, userId: users.data.items[0]?.id }),
    });
    await client.api(`/api/v1/connections/${connection.data.id}/roles`, {
      method: "POST",
      tenantId,
      body: JSON.stringify({ roleId: role.data.id }),
    });
    await client.api(`/api/v1/connections/${connection.data.id}`, {
      method: "PATCH",
      tenantId,
      body: JSON.stringify({ status: "active" }),
    });
    const minted = await client.api<{ token: string }>(
      `/api/v1/connections/${connection.data.id}/credentials`,
      { method: "POST", tenantId, body: "{}" },
    );

    const mcpName = formatMcpToolName(serverName, "echo");
    const unnamed = await client.gatewayMcp(minted.data.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: mcpName, arguments: { message: "hi" } },
    });
    const unnamedText = await unnamed.text();
    assert.match(unnamedText, /2 connected accounts/);
    assert.match(unnamedText, /Work/);
    assert.match(unnamedText, /other@example.com/);

    const unknown = await client.gatewayMcp(minted.data.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: mcpName, arguments: { account: "school", message: "hi" } },
    });
    const unknownText = await unknown.text();
    assert.match(unknownText, /Unknown account/);
    assert.match(unknownText, /school/);

    const named = await client.gatewayMcp(minted.data.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: mcpName, arguments: { account: "Work", message: "hi" } },
    });
    const namedText = await named.text();
    assert.match(namedText, /Using account Work \(me@example.com\)/);
    assert.match(namedText, /echo:hi/);
    assert.match(namedText, /auth:Bearer refreshed-me@example.com/);
    assert.equal(namedText.includes('"account"'), false);
    assert.ok(refreshTokens.has("rt-me@example.com"));
    assert.equal(refreshTokens.has("rt-other@example.com"), false);
  });
});
