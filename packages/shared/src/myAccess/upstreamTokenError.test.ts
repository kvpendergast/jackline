import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInvalidUpstreamTokenError } from "./reconnectUrl.js";

describe("isInvalidUpstreamTokenError", () => {
  it("matches common upstream auth failure strings", () => {
    assert.equal(isInvalidUpstreamTokenError("invalid_token"), true);
    assert.equal(isInvalidUpstreamTokenError("Unauthorized"), true);
    assert.equal(
      isInvalidUpstreamTokenError(new Error("Upstream HTTP GET /x → 401: nope")),
      true,
    );
    assert.equal(isInvalidUpstreamTokenError(401), true);
  });

  it("ignores unrelated errors", () => {
    assert.equal(isInvalidUpstreamTokenError("connection refused"), false);
    assert.equal(isInvalidUpstreamTokenError(new Error("timeout")), false);
    assert.equal(isInvalidUpstreamTokenError(500), false);
  });
});
