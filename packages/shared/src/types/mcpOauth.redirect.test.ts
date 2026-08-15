import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRedirectUriAllowed,
  resolveMcpOauthRedirectUris,
} from "./mcpOauth.js";

describe("resolveMcpOauthRedirectUris", () => {
  it("expands presets and custom URIs", () => {
    const result = resolveMcpOauthRedirectUris({
      redirectPresets: ["cursor-desktop", "claude-ai"],
      redirectUris: ["http://127.0.0.1:9999/callback"],
    });
    assert.equal(result.isOk(), true);
    if (result.isErr()) return;
    assert.ok(result.value.includes("http://localhost:8787/callback"));
    assert.ok(
      result.value.includes("https://claude.ai/api/mcp/auth_callback"),
    );
    assert.ok(result.value.includes("http://127.0.0.1:9999/callback"));
  });

  it("rejects empty allowlist", () => {
    const result = resolveMcpOauthRedirectUris({});
    assert.equal(result.isErr(), true);
  });
});

describe("isRedirectUriAllowed", () => {
  it("exact-matches registered URIs", () => {
    assert.equal(
      isRedirectUriAllowed("http://localhost:8787/callback", [
        "http://localhost:8787/callback",
      ]),
      true,
    );
  });

  it("allows loopback port flexibility for /callback", () => {
    assert.equal(
      isRedirectUriAllowed("http://localhost:54321/callback", [
        "http://localhost:8080/callback",
      ]),
      true,
    );
    assert.equal(
      isRedirectUriAllowed("http://127.0.0.1:54321/callback", [
        "http://localhost:8080/callback",
      ]),
      true,
    );
  });

  it("rejects unrelated hosts", () => {
    assert.equal(
      isRedirectUriAllowed("https://evil.example/callback", [
        "http://localhost:8787/callback",
      ]),
      false,
    );
  });
});
