import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  encodeOAuthSecretValue,
  resolveStoredOAuthAccessToken,
  type OAuthSecretLock,
} from "./oauth.js";
import {
  applyOAuthClientOverride,
  oauthAppSecretAad,
  resolveServerOAuthClient,
  type OAuthAppClientRef,
  type ServerOAuthClientFields,
} from "./oauthApps.js";

const server: ServerOAuthClientFields = {
  oauthAppId: null,
  oauthClientId: "server-cid",
  oauthAuthorizeUrl: "https://server.example/authorize",
  oauthTokenUrl: "https://server.example/token",
  oauthRegistrationUrl: null,
};

const app: OAuthAppClientRef = {
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "app-cid",
  authorizeUrl: null,
  tokenUrl: null,
  registrationUrl: null,
  hasClientSecret: true,
};

describe("resolveServerOAuthClient", () => {
  it("falls back exactly to the per-server fields without a linked app", () => {
    const r = resolveServerOAuthClient(server, null);
    assert.deepEqual(r, {
      source: "server",
      appId: null,
      clientId: "server-cid",
      authorizeUrl: "https://server.example/authorize",
      tokenUrl: "https://server.example/token",
      registrationUrl: null,
      publicClient: null,
    });
  });

  it("ignores a loaded app when the server is not linked to it", () => {
    assert.equal(resolveServerOAuthClient(server, app).source, "server");
    assert.equal(
      resolveServerOAuthClient(
        { ...server, oauthAppId: "22222222-2222-4222-8222-222222222222" },
        app,
      ).source,
      "server",
    );
  });

  it("falls back to the server when the linked app is missing", () => {
    const r = resolveServerOAuthClient({ ...server, oauthAppId: app.id }, null);
    assert.equal(r.source, "server");
    assert.equal(r.clientId, "server-cid");
  });

  it("uses the app client id and the server URLs when the app has none", () => {
    const r = resolveServerOAuthClient({ ...server, oauthAppId: app.id }, app);
    assert.equal(r.source, "app");
    assert.equal(r.appId, app.id);
    assert.equal(r.clientId, "app-cid");
    assert.equal(r.authorizeUrl, "https://server.example/authorize");
    assert.equal(r.tokenUrl, "https://server.example/token");
    assert.equal(r.publicClient, false);
  });

  it("prefers the app URLs when set", () => {
    const r = resolveServerOAuthClient(
      { ...server, oauthAppId: app.id },
      {
        ...app,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        registrationUrl: "  ",
      },
    );
    assert.equal(r.authorizeUrl, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(r.tokenUrl, "https://oauth2.googleapis.com/token");
    assert.equal(r.registrationUrl, null);
  });

  it("treats an app without a secret as a public client", () => {
    const r = resolveServerOAuthClient(
      { ...server, oauthAppId: app.id },
      { ...app, hasClientSecret: false },
    );
    assert.equal(r.publicClient, true);
  });
});

function tokenSecret(clientId: string, clientSecret: string | undefined) {
  const encoded = encodeOAuthSecretValue({
    mode: "refreshable",
    accessToken: "at_0",
    refreshToken: "rt_0",
    tokenUrl: "https://oauth2.example/token",
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: "s",
    expiresAt: Date.now() - 1_000,
  });
  assert.ok(encoded.isOk());
  return encoded.value;
}

describe("applyOAuthClientOverride", () => {
  it("swaps in the rotated secret when the client id matches", () => {
    const out = applyOAuthClientOverride(tokenSecret("app-cid", "old"), {
      clientId: "app-cid",
      clientSecret: "new",
    });
    const parsed = JSON.parse(out) as { clientSecret: string; refreshToken: string; clientId: string };
    assert.equal(parsed.clientSecret, "new");
    assert.equal(parsed.refreshToken, "rt_0");
    assert.equal(parsed.clientId, "app-cid");
  });

  it("keeps tokens issued to a different client untouched", () => {
    const original = tokenSecret("server-cid", "server-secret");
    assert.equal(
      applyOAuthClientOverride(original, { clientId: "app-cid", clientSecret: "new" }),
      original,
    );
  });

  it("is a no-op without an override secret or for raw tokens", () => {
    const original = tokenSecret("app-cid", "old");
    assert.equal(applyOAuthClientOverride(original, null), original);
    assert.equal(applyOAuthClientOverride(original, { clientId: "app-cid" }), original);
    assert.equal(
      applyOAuthClientOverride("raw-token", { clientId: "app-cid", clientSecret: "x" }),
      "raw-token",
    );
  });
});

describe("oauthAppSecretAad", () => {
  it("binds tenant and app id and differs from secrets-table AAD", () => {
    const a = new TextDecoder().decode(oauthAppSecretAad({ tenantId: "t", appId: "a" }));
    assert.equal(a, "t|oauth_app_client|app:a||");
    assert.notEqual(
      a,
      new TextDecoder().decode(oauthAppSecretAad({ tenantId: "t", appId: "b" })),
    );
  });
});

describe("resolveStoredOAuthAccessToken with a shared app override", () => {
  const realFetch = globalThis.fetch;
  let authHeaders: string[] = [];

  beforeEach(() => {
    authHeaders = [];
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authHeaders.push(headers["Authorization"] ?? "");
      return new Response(
        JSON.stringify({ access_token: "at_1", expires_in: 3600, token_type: "Bearer" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function store(initial: string) {
    let value = initial;
    const withLock: OAuthSecretLock = (fn) =>
      fn(value, async (p) => {
        value = p;
      });
    return {
      withLock,
      get value() {
        return value;
      },
    };
  }

  it("refreshes with the app's current secret and persists it (rotation)", async () => {
    const s = store(tokenSecret("app-cid", "old-secret"));
    let loads = 0;
    const r = await resolveStoredOAuthAccessToken({
      key: "app-rot",
      plaintext: s.value,
      withLock: s.withLock,
      clientOverride: async () => {
        loads += 1;
        return { clientId: "app-cid", clientSecret: "new-secret" };
      },
    });
    assert.ok(r.isOk());
    assert.equal(r.value.accessToken, "at_1");
    assert.equal(loads, 1);
    assert.equal(authHeaders[0], `Basic ${btoa("app-cid:new-secret")}`);
    const saved = JSON.parse(s.value) as { clientSecret: string; refreshToken: string };
    assert.equal(saved.clientSecret, "new-secret");
    assert.equal(saved.refreshToken, "rt_0");
  });

  it("does not load the override while the token is fresh", async () => {
    const fresh = JSON.stringify({
      ...(JSON.parse(tokenSecret("app-cid", "old")) as object),
      expiresAt: Date.now() + 60 * 60_000,
    });
    const s = store(fresh);
    let loads = 0;
    const r = await resolveStoredOAuthAccessToken({
      key: "app-fresh",
      plaintext: s.value,
      withLock: s.withLock,
      clientOverride: async () => {
        loads += 1;
        return null;
      },
    });
    assert.ok(r.isOk());
    assert.equal(r.value.accessToken, "at_0");
    assert.equal(loads, 0);
    assert.equal(authHeaders.length, 0);
  });

  it("falls back to embedded credentials when the override loader fails", async () => {
    const s = store(tokenSecret("app-cid", "old-secret"));
    const r = await resolveStoredOAuthAccessToken({
      key: "app-fail",
      plaintext: s.value,
      withLock: s.withLock,
      clientOverride: async () => {
        throw new Error("decrypt failed");
      },
    });
    assert.ok(r.isOk());
    assert.equal(authHeaders[0], `Basic ${btoa("app-cid:old-secret")}`);
  });
});
