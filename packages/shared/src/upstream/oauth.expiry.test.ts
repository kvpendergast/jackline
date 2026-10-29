import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeOAuthSecretValue,
  parseUpstreamOAuthSecret,
  resolveOAuthAccessToken,
} from "./oauth.js";

describe("resolveOAuthAccessToken expiry", () => {
  it("returns a fresh access token without refreshing", async () => {
    const encoded = encodeOAuthSecretValue({
      mode: "refreshable",
      accessToken: "at_fresh",
      refreshToken: "rt_1",
      tokenUrl: "https://oauth.example.com/token",
      clientId: "cid",
      clientSecret: "sec",
      expiresAt: Date.now() + 60_000,
    });
    assert.ok(encoded.isOk());
    const resolved = await resolveOAuthAccessToken(encoded.value);
    assert.ok(resolved.isOk());
    assert.equal(resolved.value.accessToken, "at_fresh");
    assert.equal(resolved.value.updatedPlaintext, undefined);
  });

  it("fails when access token is expired and no refresh grant exists", async () => {
    const encoded = encodeOAuthSecretValue({
      mode: "access_token",
      accessToken: "at_stale",
      expiresAt: Date.now() - 1_000,
    });
    assert.ok(encoded.isOk());
    const parsed = parseUpstreamOAuthSecret(encoded.value);
    assert.ok(parsed.isOk());
    assert.notEqual(typeof parsed.value, "string");

    const resolved = await resolveOAuthAccessToken(encoded.value);
    assert.ok(resolved.isErr());
    assert.match(resolved.error.message, /expired/i);
  });
});

describe("encodeOAuthSecretValue expiresAt", () => {
  it("stores access_token mode with expiresAt as JSON", () => {
    const encoded = encodeOAuthSecretValue({
      mode: "access_token",
      accessToken: "at_1",
      expiresAt: 1_700_000_000_000,
    });
    assert.ok(encoded.isOk());
    assert.ok(encoded.value.startsWith("{"));
    const parsed = JSON.parse(encoded.value) as {
      accessToken: string;
      expiresAt: number;
    };
    assert.equal(parsed.accessToken, "at_1");
    assert.equal(parsed.expiresAt, 1_700_000_000_000);
  });
});
