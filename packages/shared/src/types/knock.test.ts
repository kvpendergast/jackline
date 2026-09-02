import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KNOCK_MESSAGE_MAX_BYTES,
  validateKnockMessage,
} from "./knock.js";

describe("validateKnockMessage", () => {
  it("accepts non-empty messages within limit", () => {
    assert.equal(validateKnockMessage("hello"), null);
  });

  it("rejects empty messages", () => {
    assert.equal(validateKnockMessage(""), "Knock message is required");
  });

  it("rejects oversized messages", () => {
    const big = "a".repeat(KNOCK_MESSAGE_MAX_BYTES + 1);
    assert.match(validateKnockMessage(big)!, /exceeds/);
  });
});
