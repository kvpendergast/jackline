import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { timingSafeEqualHex } from "./timingSafe.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("timingSafeEqualHex", () => {
  it("matches equal hashes", () => {
    const hash = hashToken("secret");
    assert.equal(timingSafeEqualHex(hash, hash), true);
  });

  it("rejects different hashes", () => {
    assert.equal(
      timingSafeEqualHex(hashToken("a"), hashToken("b")),
      false,
    );
  });
});
