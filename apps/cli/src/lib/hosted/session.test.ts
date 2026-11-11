import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { getJacklinePaths } from "../paths.js";
import {
  getAccessToken,
  hostedApiGet,
  HostedAuthError,
  login,
  logout,
  normalizeServerUrl,
  sessionAccount,
  type SecretStore,
} from "./session.js";

/** Minimal fake Jackline AS + API implementing the CLI login contract. */
type FakeState = {
  codes: Map<string, { challenge: string; redirectUri: string; resource: string }>;
  refresh: Map<string, boolean>;
  access: Set<string>;
  revoked: string[];
  counter: number;
  lastAuthorize: URLSearchParams | null;
};

function startFakeServer(tenancy: "single" | "multi" = "single"): Promise<{
  url: string;
  state: FakeState;
  server: Server;
}> {
  const state: FakeState = {
    codes: new Map(),
    refresh: new Map(),
    access: new Set(),
    revoked: [],
    counter: 0,
    lastAuthorize: null,
  };
  let base = "";
  const issue = () => {
    state.counter += 1;
    const access = `jackline_uat_${state.counter}`;
    const refresh = `jackline_urt_${state.counter}`;
    state.access.add(access);
    state.refresh.set(refresh, true);
    return { access_token: access, refresh_token: refresh, expires_in: 900, token_type: "Bearer", scope: "api" };
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        revocation_endpoint: `${base}/oauth/revoke`,
        jackline_api_resource: `${base}/api/v1`,
        jackline_mcp_resource: `${base}/mcp`,
        jackline_cli_client_id: "jackline-cli",
        jackline_tenancy: tenancy,
      });
    }
    if (url.pathname === "/oauth/authorize") {
      // Stand-in for sign-in + consent: redirect straight back with a code.
      state.lastAuthorize = url.searchParams;
      const code = `code_${state.codes.size + 1}`;
      state.codes.set(code, {
        challenge: url.searchParams.get("code_challenge")!,
        redirectUri: url.searchParams.get("redirect_uri")!,
        resource: url.searchParams.get("resource")!,
      });
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }
    if (url.pathname === "/oauth/token") {
      if (form.get("grant_type") === "authorization_code") {
        const entry = state.codes.get(form.get("code") ?? "");
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !entry ||
          entry.challenge !== challenge ||
          entry.redirectUri !== form.get("redirect_uri") ||
          form.get("client_id") !== "jackline-cli" ||
          form.get("resource") !== `${base}/api/v1`
        ) {
          return json(400, { error: "invalid_grant" });
        }
        state.codes.delete(form.get("code")!);
        return json(200, issue());
      }
      if (form.get("grant_type") === "refresh_token") {
        const token = form.get("refresh_token") ?? "";
        if (state.refresh.get(token) !== true) return json(400, { error: "invalid_grant" });
        state.refresh.set(token, false);
        return json(200, issue());
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/oauth/revoke") {
      state.revoked.push(form.get("token") ?? "");
      state.refresh.set(form.get("token") ?? "", false);
      res.writeHead(200);
      return res.end();
    }
    if (url.pathname === "/api/v1/me") {
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!state.access.has(bearer)) return json(401, { success: false, error: { message: "Invalid access token" } });
      return json(200, {
        success: true,
        data: {
          user: { id: "u1", email: "kyle@example.com", name: "Kyle" },
          memberships: [{ role: "member", tenant: { id: "t1", name: "Acme", slug: "acme" } }],
          mcpUrl: `${base}/mcp`,
          current: { tenantId: "t1", role: "member", authMethod: "oauth_authorization_code" },
        },
      });
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      resolve({ url: base, state, server });
    });
  });
}

function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (account) => data.get(account) ?? null,
    set: async (account, value) => {
      data.set(account, value);
    },
    delete: async (account) => {
      data.delete(account);
    },
  };
}

/** Simulated browser: follow the authorize redirect to the loopback callback. */
const fakeBrowser = async (url: string) => {
  await fetch(url, { redirect: "follow" });
};

describe("hosted login (jackline login --server)", () => {
  let fake: Awaited<ReturnType<typeof startFakeServer>>;
  before(async () => {
    fake = await startFakeServer();
  });
  after(() => {
    fake.server.close();
    fake.server.closeAllConnections();
  });

  it("normalizes server URLs and requires https off-loopback", () => {
    assert.equal(normalizeServerUrl("jackline.example.com/"), "https://jackline.example.com");
    assert.equal(normalizeServerUrl("http://127.0.0.1:8080/"), "http://127.0.0.1:8080");
    assert.throws(() => normalizeServerUrl("http://jackline.example.com"), HostedAuthError);
  });

  it("runs PKCE on a random loopback port, stores tokens in the secret store only, refreshes, and logs out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jackline-hosted-"));
    const paths = getJacklinePaths(root);
    const store = memoryStore();

    const session = await login({
      server: fake.url,
      paths,
      store,
      openUrl: fakeBrowser,
    });
    const authorize = fake.state.lastAuthorize!;
    assert.match(authorize.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(authorize.get("code_challenge_method"), "S256");
    assert.equal(authorize.get("resource"), `${fake.url}/api/v1`);
    assert.equal(authorize.get("client_id"), "jackline-cli");
    assert.equal(session.accessToken, "jackline_uat_1");

    // Secrets only in the store; the on-disk pointer has no tokens.
    const pointer = await readFile(path.join(root, "hosted.json"), "utf8");
    assert.doesNotMatch(pointer, /jackline_u[ar]t_/);
    assert.ok(store.data.has(sessionAccount(fake.url)));

    // Fresh token is reused.
    const first = await getAccessToken(paths, { store });
    assert.equal(first.accessToken, "jackline_uat_1");

    // Near expiry → refresh with rotation persisted.
    const later = () => Date.now() + 15 * 60 * 1000;
    const refreshed = await getAccessToken(paths, { store, now: later });
    assert.equal(refreshed.accessToken, "jackline_uat_2");
    assert.equal(refreshed.session.refreshToken, "jackline_urt_2");
    const again = await getAccessToken(paths, { store });
    assert.equal(again.accessToken, "jackline_uat_2");

    const me = await hostedApiGet<{ current: { role: string } }>(paths, "/me", { store });
    assert.equal(me.current.role, "member");

    const out = await logout(paths, { store });
    assert.equal(out.revoked, true);
    assert.deepEqual(fake.state.revoked, ["jackline_urt_2"]);
    assert.equal(store.data.size, 0);
    await assert.rejects(getAccessToken(paths, { store }), /Not logged in/);
  });

  it("surfaces an expired login as a re-login prompt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jackline-hosted-"));
    const paths = getJacklinePaths(root);
    const store = memoryStore();
    const session = await login({ server: fake.url, paths, store, openUrl: fakeBrowser });
    fake.state.refresh.set(session.refreshToken, false);
    await assert.rejects(
      getAccessToken(paths, { store, forceRefresh: true }),
      /has expired\. Run `jackline login --server/,
    );
  });

  it("requires --tenant on multi-workspace servers", async () => {
    const multi = await startFakeServer("multi");
    try {
      const root = await mkdtemp(path.join(tmpdir(), "jackline-hosted-"));
      await assert.rejects(
        login({ server: multi.url, paths: getJacklinePaths(root), store: memoryStore(), openUrl: fakeBrowser }),
        /--tenant/,
      );
      const session = await login({
        server: multi.url,
        tenant: "acme",
        paths: getJacklinePaths(root),
        store: memoryStore(),
        openUrl: fakeBrowser,
      });
      assert.equal(session.tenant, "acme");
      assert.equal(multi.state.lastAuthorize!.get("tenant"), "acme");
    } finally {
      multi.server.close();
      multi.server.closeAllConnections();
    }
  });
});
