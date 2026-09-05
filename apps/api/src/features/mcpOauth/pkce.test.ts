import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { verifyPkceS256 } from "./pkce.js";

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("verifyPkceS256", () => {
  it("accepts matching verifier and challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = base64Url(
      createHash("sha256").update(verifier, "utf8").digest(),
    );
    assert.equal(verifyPkceS256(verifier, challenge), true);
  });

  it("rejects mismatched verifier", () => {
    assert.equal(verifyPkceS256("wrong", "challenge"), false);
  });
});
