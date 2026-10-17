import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeReturnTo } from "./returnTo.js";

describe("authorizeReturnTo", () => {
  it("uses the public https origin instead of the proxied http URL", () => {
    assert.equal(
      authorizeReturnTo(
        "http://jackline.example.com/oauth/authorize?client_id=a&state=b",
        "https://jackline.example.com/",
      ),
      "https://jackline.example.com/oauth/authorize?client_id=a&state=b",
    );
  });
  it("falls back to the request URL without a public base", () => {
    assert.equal(
      authorizeReturnTo("http://x/oauth/authorize?a=1", undefined),
      "http://x/oauth/authorize?a=1",
    );
  });
});
