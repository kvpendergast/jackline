import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readErrorStack, withGcpStackTrace } from "./logFormatters.js";

describe("readErrorStack", () => {
  it("reads stack from Error instances", () => {
    const err = new Error("boom");
    assert.equal(readErrorStack(err), err.stack);
  });

  it("reads stack from serialized err objects", () => {
    assert.equal(
      readErrorStack({ type: "Error", message: "boom", stack: "Error: boom\n    at x" }),
      "Error: boom\n    at x",
    );
  });

  it("returns undefined when stack is missing", () => {
    assert.equal(readErrorStack(undefined), undefined);
    assert.equal(readErrorStack({ message: "no stack" }), undefined);
  });
});

describe("withGcpStackTrace", () => {
  it("adds stack_trace without removing err", () => {
    const err = new Error("boom");
    const formatted = withGcpStackTrace({ err, requestId: "abc" });

    assert.equal(formatted.err, err);
    assert.equal(formatted.requestId, "abc");
    assert.equal(formatted.stack_trace, err.stack);
  });

  it("leaves object unchanged when err has no stack", () => {
    const input = { requestId: "abc" };
    assert.deepEqual(withGcpStackTrace(input), input);
  });
});
