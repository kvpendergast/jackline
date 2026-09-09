import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode } from "../errors/index.js";
import {
  UpstreamCredentialFailureError,
  formatUpstreamCredentialFailure,
  isPersonalUpstreamCredentialFailure,
  myAccessReconnectUrl,
  upstreamCredentialFailure,
} from "./reconnectUrl.js";

describe("myAccessReconnectUrl", () => {
  it("builds a deep link with server id", () => {
    assert.equal(
      myAccessReconnectUrl("https://app.example.com/", "srv_123"),
      "https://app.example.com/my-access?server=srv_123",
    );
  });
});

describe("UpstreamCredentialFailureError", () => {
  it("marks personal failures as URL elicitation", () => {
    const error = upstreamCredentialFailure({
      webOrigin: "https://app.example.com",
      serverId: "srv_1",
      serverName: "Gmail",
      kind: "expired_personal",
    });
    assert.ok(error instanceof UpstreamCredentialFailureError);
    assert.equal(error.code, ErrorCode.FORBIDDEN);
    assert.equal(error.requiresUrlElicitation, true);
    assert.equal(
      error.reconnectUrl,
      "https://app.example.com/my-access?server=srv_1",
    );
    assert.match(error.message, /Open My Access to reconnect:/);
    assert.match(error.message, /Do not wipe or re-authenticate the Jackline MCP gateway/);
    assert.ok(isPersonalUpstreamCredentialFailure(error.kind));
  });

  it("does not elicit for shared credential failures", () => {
    const error = upstreamCredentialFailure({
      webOrigin: "https://app.example.com",
      serverId: "srv_1",
      serverName: "BigQuery",
      kind: "expired_shared",
    });
    assert.equal(error.requiresUrlElicitation, false);
    assert.equal(error.reconnectUrl, null);
    assert.equal(
      formatUpstreamCredentialFailure({
        webOrigin: "https://app.example.com",
        serverId: "srv_1",
        serverName: "BigQuery",
        kind: "expired_shared",
      }),
      error.message,
    );
    assert.match(error.message, /Do not wipe or re-authenticate the Jackline MCP gateway/);
  });
});
