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

  it("matches Google OAuth / MCP host auth failure text", () => {
    assert.equal(
      isInvalidUpstreamTokenError(
        "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
      ),
      true,
    );
    assert.equal(
      isInvalidUpstreamTokenError(
        "Upstream tool call failed: Streamable HTTP error: Error POSTing to endpoint: 401",
      ),
      true,
    );
    assert.equal(
      isInvalidUpstreamTokenError('detail="authentication_required"'),
      true,
    );
  });

  it("ignores unrelated errors", () => {
    assert.equal(isInvalidUpstreamTokenError("connection refused"), false);
    assert.equal(isInvalidUpstreamTokenError(new Error("timeout")), false);
    assert.equal(isInvalidUpstreamTokenError(500), false);
  });
});
