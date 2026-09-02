import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KNOCK_MESSAGE_MAX_BYTES,
  validateKnockMessage,
} from "./knock.js";

describe("validateKnockMessage", () => {
  it("accepts non-empty messages within limit", () => {
    assert.equal(validateKnockMessage("hello").isOk(), true);
  });

  it("rejects empty messages", () => {
    const result = validateKnockMessage("");
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.match(result.error.message, /required/i);
    }
  });

  it("rejects oversized messages", () => {
    const big = "a".repeat(KNOCK_MESSAGE_MAX_BYTES + 1);
    const result = validateKnockMessage(big);
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.match(result.error.message, /exceeds/);
    }
  });
});
