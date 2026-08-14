import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml } from "../lib/oauthConnect.js";

describe("escapeHtml (OAuth callback XSS)", () => {
  it("escapes HTML special characters", () => {
    assert.equal(
      escapeHtml(`<img src=x onerror="alert(1)">&'"`),
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&quot;",
    );
  });

  it("neutralizes script tags in error_description-like payloads", () => {
    const payload = `<script>alert('xss')</script>`;
    const escaped = escapeHtml(payload);
    assert.equal(escaped.includes("<script>"), false);
    assert.equal(escaped.includes("</script>"), false);
    assert.match(escaped, /&lt;script&gt;/);
    assert.match(escaped, /&lt;\/script&gt;/);
  });

  it("leaves plain text unchanged", () => {
    assert.equal(escapeHtml("access_denied"), "access_denied");
  });
});
