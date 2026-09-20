import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeGoogleCredentials } from "./probeGoogleCredentials.js";

describe("probeGoogleCredentials", () => {
  it("returns ok when Google accepts credentials (invalid_grant)", async () => {
    const result = await probeGoogleCredentials({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://example.com/api/auth/callback/google",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result, "ok");
  });

  it("returns invalid_client when Google rejects the secret", async () => {
    const result = await probeGoogleCredentials({
      clientId: "id",
      clientSecret: "wrong",
      redirectUri: "https://example.com/api/auth/callback/google",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result, "invalid_client");
  });

  it("returns unreachable when fetch throws", async () => {
    const result = await probeGoogleCredentials({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://example.com/api/auth/callback/google",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(result, "unreachable");
  });

  it("returns unreachable when the request times out", async () => {
    const result = await probeGoogleCredentials({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://example.com/api/auth/callback/google",
      timeoutMs: 20,
      fetchImpl: async (_url, init) => {
        await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    });
    assert.equal(result, "unreachable");
  });
});
