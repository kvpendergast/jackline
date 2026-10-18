import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginPathWithReturnTo, safeLoginReturnTo } from "./safeReturnTo.js";

const origin = "https://jackline.example.com";

describe("safeLoginReturnTo", () => {
  it("accepts relative paths and same-origin URLs", () => {
    assert.equal(safeLoginReturnTo("/my-access?server=abc", origin), "/my-access?server=abc");
    assert.equal(
      safeLoginReturnTo("https://jackline.example.com/oauth/authorize?a=1", origin),
      "https://jackline.example.com/oauth/authorize?a=1",
    );
  });
  it("rejects open-redirect shapes", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "https://jackline.example.com.evil.example/",
      "my-access",
      "",
    ]) {
      assert.equal(safeLoginReturnTo(bad, origin), null, bad);
    }
    assert.equal(safeLoginReturnTo(null, origin), null);
  });
});

describe("loginPathWithReturnTo", () => {
  it("encodes the current location", () => {
    assert.equal(
      loginPathWithReturnTo({ pathname: "/my-access", search: "?server=1&x=2" }),
      "/login?return_to=%2Fmy-access%3Fserver%3D1%26x%3D2",
    );
  });
  it("skips root and auth pages", () => {
    assert.equal(loginPathWithReturnTo({ pathname: "/", search: "" }), "/login");
    assert.equal(loginPathWithReturnTo({ pathname: "/verify-email", search: "" }), "/login");
  });
});
