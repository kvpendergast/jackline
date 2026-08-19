import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { hashToken } from "./hash.js";

describe("hashToken", () => {
  it("returns sha256 hex of the input", () => {
    const token = "jkl_mcp_at_example";
    const expected = createHash("sha256").update(token).digest("hex");
    assert.equal(hashToken(token), expected);
  });

  it("is stable for the same input", () => {
    assert.equal(hashToken("abc"), hashToken("abc"));
  });
});
