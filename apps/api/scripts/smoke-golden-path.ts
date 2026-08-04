/**
 * Golden-path smoke: signup/sign-in → catalog → policy → connection credential →
 * gateway tools/list → quarantine kill-switch.
 *
 * Requires API + gateway already running:
 *   pnpm --filter @mesh/api smoke
 */
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@mesh/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvFile(path.join(root, ".env"));
const configResult = loadConfig();
if (configResult.isErr()) throw configResult.error;

const API = process.env.SMOKE_API_URL ?? "http://127.0.0.1:8080";
const GATEWAY = process.env.SMOKE_GATEWAY_URL ?? "http://127.0.0.1:8081";
const ORIGIN = process.env.SMOKE_ORIGIN ?? configResult.value.WEB_ORIGIN;
const email = `smoke-${Date.now()}@mesh.local`;
const password = "smoke-password-12345";
const jar = new Map<string, string>();

function storeCookies(res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      jar.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
    }
  }
}

function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function api<T>(
  pathName: string,
  init: RequestInit & { tenantId?: string } = {},
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Origin", ORIGIN);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.tenantId) headers.set("X-Mesh-Tenant-Id", init.tenantId);
  const cookie = cookieHeader();
  if (cookie) headers.set("Cookie", cookie);

  const res = await fetch(`${API}${pathName}`, { ...init, headers });
  storeCookies(res);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok || json?.success === false) {
    const message = json?.error?.message ?? text ?? res.statusText;
    throw new Error(
      `${init.method ?? "GET"} ${pathName} → ${res.status}: ${message}`,
    );
  }
  return { status: res.status, data: json.data as T };
}

async function ensureSession(): Promise<string> {
  const { auth, initAuth } = await import("@mesh/auth");
  await initAuth();
  const { db, memberships, tenants } = await import("@mesh/db");

  const signup = await fetch(`${API}/api/v1/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({
      email,
      password,
      name: "Smoke Admin",
      organizationName: `Smoke Org ${Date.now()}`,
    }),
  });
  storeCookies(signup);
  const signupJson = await signup.json();

  if (signup.ok && signupJson.success) {
    console.log("✓ signup created tenant");
    return signupJson.data.tenant.id as string;
  }

  if (signupJson?.error?.code !== "TENANT_LIMIT_REACHED") {
    throw new Error(
      `signup failed: ${signupJson?.error?.message ?? signup.status}`,
    );
  }

  console.log(
    "· single-tenant already seeded; attaching smoke user to existing tenant",
  );

  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("No tenant in database");

  const authRes = await auth.api.signUpEmail({
    body: { email, password, name: "Smoke Admin" },
    asResponse: true,
  });
  if (!authRes.ok) {
    throw new Error(`auth signUpEmail failed: ${await authRes.text()}`);
  }
  const authJson = (await authRes.clone().json()) as { user: { id: string } };

  await db.insert(memberships).values({
    userId: authJson.user.id,
    tenantId: tenant.id,
    role: "full_admin",
  });

  const signIn = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ email, password }),
  });
  storeCookies(signIn);
  if (!signIn.ok) {
    throw new Error(`sign-in failed: ${await signIn.text()}`);
  }
  console.log("✓ signed in smoke admin on existing tenant");
  return tenant.id;
}

async function main() {
  const { getAllowedTools } = await import("@mesh/policy");

  console.log("Smoke golden path");
  console.log(`API=${API} GATEWAY=${GATEWAY}`);

  const apiHealth = await fetch(`${API}/health`);
  if (!apiHealth.ok) throw new Error("API /health failed");
  console.log("✓ API health");

  const gwHealth = await fetch(`${GATEWAY}/health`);
  if (!gwHealth.ok) throw new Error("Gateway /health failed");
  console.log("✓ Gateway health");

  const policy = getAllowedTools([
    {
      id: "t1",
      status: "active",
      permission: "allow",
      serverStatus: "active",
    },
    {
      id: "t1",
      status: "active",
      permission: "deny",
      serverStatus: "active",
    },
  ]);
  if (!policy.isOk() || policy.value.length !== 0) {
    throw new Error("policy deny-wins check failed");
  }
  console.log("✓ policy deny-wins");

  const tenantId = await ensureSession();

  const me = await api<{ user: { email: string } }>("/api/v1/me");
  console.log(`✓ me ${me.data.user.email}`);

  const server = await api<{ id: string }>("/api/v1/servers", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: `smoke-server-${Date.now()}`,
      baseUrl: "https://example.com/mcp",
      authMethod: "api_key",
      kind: "mcp",
    }),
  });
  await api(`/api/v1/servers/${server.data.id}`, {
    method: "PATCH",
    tenantId,
    body: JSON.stringify({ status: "active" }),
  });
  console.log("✓ server active");

  const tool = await api<{ id: string; name: string }>("/api/v1/tools", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: "smoke/echo",
      serverId: server.data.id,
      status: "active",
    }),
  });
  console.log(`✓ tool ${tool.data.name}`);

  const role = await api<{ id: string }>("/api/v1/roles", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: `smoke-grant-${Date.now()}`,
      type: "grant",
    }),
  });
  await api(`/api/v1/roles/${role.data.id}/tools`, {
    method: "PUT",
    tenantId,
    body: JSON.stringify({ toolIds: [tool.data.id] }),
  });
  console.log("✓ role + tools");

  const client = await api<{ id: string }>("/api/v1/clients", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      name: `smoke-client-${Date.now()}`,
      kind: "interactive",
    }),
  });

  const users = await api<{ items: { id: string }[] }>(
    "/api/v1/users?limit=50",
    { tenantId },
  );
  const userId = users.data.items[0]?.id;
  if (!userId) throw new Error("No tenant user for connection subject");

  const connection = await api<{ id: string }>("/api/v1/connections", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ clientId: client.data.id, userId }),
  });
  await api(`/api/v1/connections/${connection.data.id}/roles`, {
    method: "POST",
    tenantId,
    body: JSON.stringify({ roleId: role.data.id }),
  });
  await api(`/api/v1/connections/${connection.data.id}`, {
    method: "PATCH",
    tenantId,
    body: JSON.stringify({ status: "active" }),
  });
  console.log("✓ connection + role");

  await api("/api/v1/secrets", {
    method: "POST",
    tenantId,
    body: JSON.stringify({
      kind: "api_key",
      name: "smoke-upstream",
      value: "not-a-real-key",
      serverId: server.data.id,
    }),
  });
  console.log("✓ upstream secret");

  const minted = await api<{ token: string }>(
    `/api/v1/connections/${connection.data.id}/credentials`,
    { method: "POST", tenantId, body: "{}" },
  );
  console.log("✓ gateway credential minted");

  const initRes = await fetch(`${GATEWAY}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${minted.data.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    }),
  });
  if (!initRes.ok) {
    throw new Error(
      `gateway initialize → ${initRes.status}: ${await initRes.text()}`,
    );
  }
  console.log("✓ gateway initialize");

  const toolsList = await fetch(`${GATEWAY}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${minted.data.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }),
  });
  const toolsText = await toolsList.text();
  if (!toolsList.ok) {
    throw new Error(`gateway tools/list → ${toolsList.status}: ${toolsText}`);
  }
  if (!toolsText.includes("smoke")) {
    throw new Error(
      `gateway tools/list missing smoke tool: ${toolsText.slice(0, 500)}`,
    );
  }
  console.log("✓ gateway tools/list includes smoke tool");

  await api(`/api/v1/connections/${connection.data.id}`, {
    method: "PATCH",
    tenantId,
    body: JSON.stringify({ status: "quarantined" }),
  });
  console.log("✓ connection quarantined");

  const denied = await fetch(`${GATEWAY}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${minted.data.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    }),
  });
  if (denied.status !== 403) {
    throw new Error(
      `expected gateway 403 after quarantine, got ${denied.status}: ${await denied.text()}`,
    );
  }
  console.log("✓ gateway rejects quarantined connection");

  console.log("\nGolden path OK");
}

main().catch((err) => {
  console.error("\nGolden path FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
