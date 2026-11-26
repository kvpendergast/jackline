import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMcpToolName, sanitizeMcpNameSegment } from "./toolName.js";

describe("sanitizeMcpNameSegment", () => {
  it("keeps letters, digits, underscores and hyphens", () => {
    assert.equal(sanitizeMcpNameSegment("Gmail_work"), "Gmail_work");
    assert.equal(sanitizeMcpNameSegment("hello-world"), "hello-world");
    assert.equal(sanitizeMcpNameSegment("a__b"), "a__b");
    assert.equal(sanitizeMcpNameSegment("search"), "search");
  });

  it("collapses other characters and trims edge underscores", () => {
    assert.equal(sanitizeMcpNameSegment("Gmail (work)"), "Gmail_work");
    assert.equal(sanitizeMcpNameSegment("foo/bar.baz"), "foo_bar_baz");
    assert.equal(sanitizeMcpNameSegment("__foo__"), "foo");
    assert.equal(sanitizeMcpNameSegment("  hello  "), "hello");
    assert.equal(sanitizeMcpNameSegment("___"), "x");
    assert.equal(sanitizeMcpNameSegment(""), "x");
  });

  it("finishes a long underscore string without backtracking", () => {
    const started = Date.now();
    const sanitized = sanitizeMcpNameSegment("_".repeat(200_000));
    const elapsed = Date.now() - started;
    assert.equal(sanitized, "x");
    assert.ok(elapsed < 200, `took ${elapsed}ms`);
  });

  it("formats server and tool segments", () => {
    assert.equal(formatMcpToolName("Gmail (work)", "list_accounts"), "Gmail_work__list_accounts");
  });
});
