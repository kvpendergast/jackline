import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPeerGrantToken,
  parsePeerGrantToken,
  extractBearerToken,
} from "./peerGrantCredential.js";

describe("parsePeerGrantToken", () => {
  const secretId = "00000000-0000-4000-8000-000000000001";
  const secret = "abc123";
  const token = formatPeerGrantToken(secretId, secret);

  it("parses valid jka_ tokens", () => {
    const result = parsePeerGrantToken(token);
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.equal(result.value.secretId, secretId);
      assert.equal(result.value.secret, secret);
    }
  });

  it("rejects wrong prefix", () => {
    const result = parsePeerGrantToken(`jkl_${secretId}.${secret}`);
    assert.equal(result.isErr(), true);
  });

  it("rejects malformed tokens", () => {
    assert.equal(parsePeerGrantToken("jka_not-a-uuid.secret").isErr(), true);
    assert.equal(parsePeerGrantToken("jka_uuid.").isErr(), true);
    assert.equal(parsePeerGrantToken("jka_uuid").isErr(), true);
  });
});

describe("extractBearerToken", () => {
  it("extracts bearer credentials", () => {
    assert.equal(
      extractBearerToken("Bearer jka_abc.def"),
      "jka_abc.def",
    );
    assert.equal(extractBearerToken("bearer jka_abc.def"), "jka_abc.def");
  });

  it("returns null when missing", () => {
    assert.equal(extractBearerToken(undefined), null);
    assert.equal(extractBearerToken("Basic abc"), null);
  });
});
