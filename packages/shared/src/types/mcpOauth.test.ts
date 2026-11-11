import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { jacklineApiResource, redirectUriMatches } from "./mcpOauth.js";

describe("redirectUriMatches (RFC 8252 loopback)", () => {
  it("matches exact strings", () => {
    assert.equal(
      redirectUriMatches("https://app.example.com/cb", "https://app.example.com/cb"),
      true,
    );
  });

  it("ignores the port for http loopback IP literals", () => {
    assert.equal(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:53111/callback"),
      true,
    );
    assert.equal(
      redirectUriMatches("http://[::1]/callback", "http://[::1]:4000/callback"),
      true,
    );
  });

  it("still requires host, path and query to match", () => {
    assert.equal(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:1/other"),
      false,
    );
    assert.equal(
      redirectUriMatches("http://127.0.0.1/callback", "http://[::1]:1/callback"),
      false,
    );
    assert.equal(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:1/callback?x=1"),
      false,
    );
    assert.equal(
      redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:1/callback#f"),
      false,
    );
    assert.equal(
      redirectUriMatches("http://127.0.0.1/callback", "http://u:p@127.0.0.1:1/callback"),
      false,
    );
  });

  it("does not relax localhost, https, or non-loopback hosts", () => {
    assert.equal(
      redirectUriMatches("http://localhost/callback", "http://localhost:1234/callback"),
      false,
    );
    assert.equal(
      redirectUriMatches("https://127.0.0.1/callback", "https://127.0.0.1:1/callback"),
      false,
    );
    assert.equal(
      redirectUriMatches("http://example.com/callback", "http://example.com:81/callback"),
      false,
    );
    assert.equal(redirectUriMatches("not a url", "http://127.0.0.1:1/x"), false);
  });
});

describe("jacklineApiResource", () => {
  it("is the API base + /api/v1 without trailing slash duplication", () => {
    assert.equal(jacklineApiResource("https://j.example.com/"), "https://j.example.com/api/v1");
    assert.equal(jacklineApiResource("http://127.0.0.1:8080"), "http://127.0.0.1:8080/api/v1");
  });
});
