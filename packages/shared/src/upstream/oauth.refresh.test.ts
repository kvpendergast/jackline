import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  classifyOAuthRefreshFailure,
  encodeOAuthSecretValue,
  OAUTH_REFRESH_SKEW_MS,
  resolveOAuthAccessToken,
  resolveStoredOAuthAccessToken,
  type OAuthSecretLock,
} from "./oauth.js";

type Call = { url: string; body: URLSearchParams; headers: Record<string, string> };

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let responder: (call: Call, n: number) => Promise<Response> | Response;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      body: new URLSearchParams(String(init?.body ?? "")),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return responder(call, calls.length);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Rotating provider (Linear-like): every refresh mints at_N / rt_N, old rt dies. */
function rotatingProvider() {
  let live = "rt_0";
  let n = 0;
  return (call: Call) => {
    const rt = call.body.get("refresh_token");
    if (rt !== live) {
      return json(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
    }
    n += 1;
    live = `rt_${n}`;
    return json(200, {
      access_token: `at_${n}`,
      refresh_token: live,
      expires_in: 86399,
      token_type: "Bearer",
    });
  };
}

function secret(overrides: { accessToken?: string; refreshToken?: string; expiresAt?: number; clientSecret?: string | null } = {}) {
  const encoded = encodeOAuthSecretValue({
    mode: "refreshable",
    accessToken: overrides.accessToken ?? "at_0",
    refreshToken: overrides.refreshToken ?? "rt_0",
    tokenUrl: "https://api.linear.app/oauth/token",
    clientId: "cid",
    ...(overrides.clientSecret === null ? {} : { clientSecret: overrides.clientSecret ?? "csec" }),
    scopes: "read,write",
    expiresAt: overrides.expiresAt ?? Date.now() - 1_000,
  });
  assert.ok(encoded.isOk());
  return encoded.value;
}

/** In-memory row with an async mutex, standing in for SELECT … FOR UPDATE. */
function memoryStore(initial: string) {
  let value = initial;
  let chain: Promise<unknown> = Promise.resolve();
  let saves = 0;
  const withLock: OAuthSecretLock = (fn) => {
    const next = chain.then(() =>
      fn(value, async (p) => {
        saves += 1;
        value = p;
      }),
    );
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    withLock,
    get value() {
      return value;
    },
    get saves() {
      return saves;
    },
  };
}

describe("resolveStoredOAuthAccessToken", () => {
  it("refreshes proactively inside the skew window", async () => {
    responder = rotatingProvider();
    const store = memoryStore(secret({ expiresAt: Date.now() + OAUTH_REFRESH_SKEW_MS / 2 }));
    const r = await resolveStoredOAuthAccessToken({ key: "k-skew", plaintext: store.value, withLock: store.withLock });
    assert.ok(r.isOk());
    assert.equal(r.value.accessToken, "at_1");
    assert.equal(calls.length, 1);
  });

  it("does not refresh a token that is fresh beyond the skew", async () => {
    responder = rotatingProvider();
    const store = memoryStore(secret({ expiresAt: Date.now() + 10 * 60_000 }));
    const r = await resolveStoredOAuthAccessToken({ key: "k-fresh", plaintext: store.value, withLock: store.withLock });
    assert.ok(r.isOk());
    assert.equal(r.value.accessToken, "at_0");
    assert.equal(calls.length, 0);
  });

  it("persists the rotated refresh token so the next refresh uses it", async () => {
    responder = rotatingProvider();
    const store = memoryStore(secret());
    const first = await resolveStoredOAuthAccessToken({ key: "k-rot", plaintext: store.value, withLock: store.withLock });
    assert.ok(first.isOk());
    const saved = JSON.parse(store.value) as { refreshToken: string; accessToken: string; expiresAt: number; clientSecret: string };
    assert.equal(saved.refreshToken, "rt_1");
    assert.equal(saved.accessToken, "at_1");
    assert.equal(saved.clientSecret, "csec");
    assert.ok(saved.expiresAt > Date.now() + 86_000_000);

    // A day later: forced (401) refresh must spend rt_1, not the dead rt_0.
    const second = await resolveStoredOAuthAccessToken({
      key: "k-rot",
      plaintext: store.value,
      withLock: store.withLock,
      forceRefresh: true,
    });
    assert.ok(second.isOk());
    assert.equal(second.value.accessToken, "at_2");
    assert.equal(calls[1]?.body.get("refresh_token"), "rt_1");
  });

  it("single-flights concurrent in-process refreshes", async () => {
    responder = rotatingProvider();
    const store = memoryStore(secret());
    const stale = store.value;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        resolveStoredOAuthAccessToken({ key: "k-sf", plaintext: stale, withLock: store.withLock }),
      ),
    );
    assert.equal(calls.length, 1);
    for (const r of results) {
      assert.ok(r.isOk());
      assert.equal(r.value.accessToken, "at_1");
    }
  });

  it("reuses a token another process refreshed while waiting on the lock", async () => {
    responder = rotatingProvider();
    const store = memoryStore(secret());
    const stale = store.value;
    // Different keys simulate two processes that only share the DB row lock.
    const [a, b] = await Promise.all([
      resolveStoredOAuthAccessToken({ key: "proc-a", plaintext: stale, withLock: store.withLock }),
      resolveStoredOAuthAccessToken({ key: "proc-b", plaintext: stale, withLock: store.withLock, forceRefresh: true }),
    ]);
    assert.ok(a.isOk() && b.isOk());
    assert.equal(calls.length, 1, "second process must not spend the rotated-away refresh token");
    assert.equal(a.value.accessToken, "at_1");
    assert.equal(b.value.accessToken, "at_1");
    assert.equal(store.saves, 1);
  });

  it("classifies invalid_grant as reauth", async () => {
    responder = () => json(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
    const store = memoryStore(secret());
    const r = await resolveStoredOAuthAccessToken({ key: "k-ig", plaintext: store.value, withLock: store.withLock });
    assert.ok(r.isErr());
    assert.equal(classifyOAuthRefreshFailure(r.error), "reauth");
    assert.equal(store.saves, 0);
  });

  for (const [label, make] of [
    ["503", () => json(503, { error: "temporarily_unavailable" })],
    ["429", () => json(429, { error: "rate_limited" })],
    ["HTML 502", () => new Response("<html>bad gateway</html>", { status: 502 })],
    ["network", () => Promise.reject(new TypeError("fetch failed"))],
  ] as const) {
    it(`classifies ${label} as transient, not reauth`, async () => {
      responder = make as () => Promise<Response>;
      const store = memoryStore(secret());
      const r = await resolveStoredOAuthAccessToken({ key: `k-${label}`, plaintext: store.value, withLock: store.withLock });
      assert.ok(r.isErr());
      assert.equal(classifyOAuthRefreshFailure(r.error), "transient");
      assert.equal(JSON.parse(store.value).refreshToken, "rt_0", "grant left intact");
    });
  }

  it("classifies invalid_client as config, not reauth", async () => {
    responder = () => json(401, { error: "invalid_client" });
    const store = memoryStore(secret());
    const r = await resolveStoredOAuthAccessToken({ key: "k-ic", plaintext: store.value, withLock: store.withLock });
    assert.ok(r.isErr());
    assert.equal(classifyOAuthRefreshFailure(r.error), "config");
  });

  it("keeps a still-valid token when a proactive refresh fails transiently", async () => {
    responder = () => json(503, { error: "temporarily_unavailable" });
    const store = memoryStore(secret({ expiresAt: Date.now() + 30_000 }));
    const r = await resolveStoredOAuthAccessToken({ key: "k-grace", plaintext: store.value, withLock: store.withLock });
    assert.ok(r.isOk());
    assert.equal(r.value.accessToken, "at_0");
  });

  it("reports a persist failure as transient", async () => {
    responder = rotatingProvider();
    const failing: OAuthSecretLock = (fn) =>
      fn(secret(), async () => {
        throw new Error("db down");
      });
    const r = await resolveStoredOAuthAccessToken({ key: "k-persist", plaintext: secret(), withLock: failing });
    assert.ok(r.isErr());
    assert.equal(classifyOAuthRefreshFailure(r.error), "transient");
  });

  it("reports a lock failure as transient", async () => {
    responder = rotatingProvider();
    const broken: OAuthSecretLock = async () => {
      throw new Error("connection refused");
    };
    const r = await resolveStoredOAuthAccessToken({ key: "k-lock", plaintext: secret(), withLock: broken });
    assert.ok(r.isErr());
    assert.equal(classifyOAuthRefreshFailure(r.error), "transient");
  });
});

describe("refresh_token request shape", () => {
  it("uses Basic auth for confidential clients and omits scope", async () => {
    responder = rotatingProvider();
    const r = await resolveOAuthAccessToken(secret(), { forceRefresh: true });
    assert.ok(r.isOk());
    const call = calls[0]!;
    assert.equal(call.body.get("grant_type"), "refresh_token");
    assert.equal(call.body.get("scope"), null);
    assert.equal(call.body.get("client_id"), null);
    assert.match(call.headers["Authorization"] ?? "", /^Basic /);
  });

  it("sends client_id in the body for public (PKCE/DCR) clients", async () => {
    responder = rotatingProvider();
    const r = await resolveOAuthAccessToken(secret({ clientSecret: null }), { forceRefresh: true });
    assert.ok(r.isOk());
    const call = calls[0]!;
    assert.equal(call.body.get("client_id"), "cid");
    assert.equal(call.headers["Authorization"], undefined);
  });

  it("keeps the previous refresh token when the provider does not rotate", async () => {
    responder = () => json(200, { access_token: "at_g", expires_in: 3599 });
    const r = await resolveOAuthAccessToken(secret(), { forceRefresh: true });
    assert.ok(r.isOk());
    assert.equal(JSON.parse(r.value.updatedPlaintext!).refreshToken, "rt_0");
  });
});
