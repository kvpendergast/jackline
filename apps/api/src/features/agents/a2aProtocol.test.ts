import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErrorCode } from "@jackline/shared";

import {
  authDenialToError,
  extractKnockPayload,
  isKnockIntent,
} from "./a2aProtocol.js";

describe("extractKnockPayload", () => {
  it("parses a valid knock payload", () => {
    const result = extractKnockPayload({
      peerAgentCardUrl: "https://peer.example/card.json",
      message: {
        parts: [{ kind: "text", text: "hello" }],
        metadata: { intent: "jackline.trust.request" },
      },
    });
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.equal(result.value.message, "hello");
      assert.equal(result.value.intent, "jackline.trust.request");
    }
  });

  it("rejects invalid payloads", () => {
    assert.equal(extractKnockPayload(undefined).isErr(), true);
    assert.equal(extractKnockPayload({}).isErr(), true);
  });
});

describe("authDenialToError", () => {
  it("maps auth required to UnauthorizedError", () => {
    const error = authDenialToError("Authentication required");
    assert.equal(error.code, ErrorCode.UNAUTHORIZED);
  });
});

describe("isKnockIntent", () => {
  it("accepts explicit and default intents", () => {
    assert.equal(
      isKnockIntent({
        peerAgentCardUrl: "https://peer.example/card.json",
        message: "hi",
        intent: "jackline.trust.request",
      }),
      true,
    );
    assert.equal(
      isKnockIntent({
        peerAgentCardUrl: "https://peer.example/card.json",
        message: "hi",
      }),
      true,
    );
  });
});
