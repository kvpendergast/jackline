import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { err, ok } from "neverthrow";
import { JacklineError } from "@jackline/shared";
import { callWithAuthRetry, type UpstreamAttemptFailure } from "./authRetry.js";

const rejected = (msg = "401 invalid_token"): UpstreamAttemptFailure => ({
  error: new JacklineError("INTERNAL", msg),
  authRejected: true,
});
const expired = () => new JacklineError("FORBIDDEN", "expired: reconnect");

describe("callWithAuthRetry", () => {
  it("returns the first success without refreshing", async () => {
    const forced: boolean[] = [];
    const r = await callWithAuthRetry({
      attempt: async (f) => (forced.push(f), ok("v")),
      expiredError: expired,
    });
    assert.ok(r.isOk());
    assert.deepEqual(forced, [false]);
  });

  it("force-refreshes and retries exactly once after a 401", async () => {
    const forced: boolean[] = [];
    const r = await callWithAuthRetry({
      attempt: async (f) => {
        forced.push(f);
        return f ? ok("v2") : err(rejected());
      },
      expiredError: expired,
    });
    assert.ok(r.isOk());
    assert.equal(r.value, "v2");
    assert.deepEqual(forced, [false, true]);
  });

  it("asks for reconnect when a freshly refreshed token is also rejected", async () => {
    const forced: boolean[] = [];
    const r = await callWithAuthRetry({
      attempt: async (f) => (forced.push(f), err(rejected())),
      expiredError: expired,
    });
    assert.ok(r.isErr());
    assert.equal(r.error.message, "expired: reconnect");
    assert.deepEqual(forced, [false, true], "no third attempt / second refresh");
  });

  it("does not retry non-auth failures (refresh errors, transient, tool errors)", async () => {
    const forced: boolean[] = [];
    const transient = new JacklineError("INTERNAL", "refresh failed temporarily");
    const r = await callWithAuthRetry({
      attempt: async (f) => (forced.push(f), err({ error: transient, authRejected: false })),
      expiredError: expired,
    });
    assert.ok(r.isErr());
    assert.equal(r.error, transient);
    assert.deepEqual(forced, [false]);
  });

  it("surfaces a refresh failure on the retry unchanged (not as expired)", async () => {
    const transient = new JacklineError("INTERNAL", "refresh 503");
    const r = await callWithAuthRetry({
      attempt: async (f) => (f ? err({ error: transient, authRejected: false }) : err(rejected())),
      expiredError: expired,
    });
    assert.ok(r.isErr());
    assert.equal(r.error, transient);
  });
});
