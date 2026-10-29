import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { originsFromRedirectUris, validateReturnTo } from "./returnTo.js";

const allowed = ["https://grok.com", "https://app.jackline.test"];

describe("validateReturnTo", () => {
  it("accepts allowed https origins", () => {
    assert.equal(
      validateReturnTo("https://grok.com/chat/1?x=2", allowed),
      "https://grok.com/chat/1?x=2",
    );
  });
  it("rejects unlisted origins, http, other schemes, credentials", () => {
    for (const bad of [
      "https://evil.example/",
      "http://grok.com/",
      "javascript:alert(1)",
      "cursor://anysphere.cursor/callback",
      "https://grok.com@evil.example/",
      "https://user:pw@grok.com/",
      "https://grok.com.evil.example/",
      "//evil.example",
      "/relative",
      "https://grok.com/\\@evil.example",
      "",
    ]) {
      assert.equal(validateReturnTo(bad, allowed), null, bad);
    }
    assert.equal(validateReturnTo(undefined, allowed), null);
  });
});

describe("originsFromRedirectUris", () => {
  it("keeps only https origins", () => {
    assert.deepEqual(
      originsFromRedirectUris([
        "https://grok.com/oauth/callback",
        "http://localhost:3000/cb",
        "cursor://x/y",
        "https://grok.com/other",
      ]),
      ["https://grok.com"],
    );
  });
});
