import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideA2aAuth, UnauthorizedError } from "@jackline/shared";

/** Mirrors the knock credential gate in agentServices.processA2aJsonRpc. */
function knockRequiresApiCredential(
  hasApiCredential: boolean,
  decision: ReturnType<typeof decideA2aAuth>,
): UnauthorizedError | null {
  if (decision.action === "knock_only" && !hasApiCredential) {
    return new UnauthorizedError("Authentication required");
  }
  return null;
}

describe("A2A knock API credential gate", () => {
  it("allows knock path when caller has a Jackline credential", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: true,
    });
    assert.equal(decision.action, "knock_only");
    assert.equal(knockRequiresApiCredential(true, decision), null);
  });

  it("rejects knock path without a Jackline credential", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: true,
    });
    const error = knockRequiresApiCredential(false, decision);
    assert.ok(error instanceof UnauthorizedError);
  });

  it("does not require API credential for granted peers", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: true,
      trustGrantId: "00000000-0000-4000-8000-000000000001",
      isKnockIntent: false,
    });
    assert.equal(knockRequiresApiCredential(false, decision), null);
  });
});
