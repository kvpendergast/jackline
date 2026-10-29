import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideA2aAuth } from "@jackline/shared";

describe("A2A public knock auth policy", () => {
  it("allows anonymous knock_only without a Jackline credential", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: true,
    });
    assert.equal(decision.action, "knock_only");
  });

  it("allows anonymous tasks/get poll as task_poll", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "tasks/get",
      hasValidGrant: false,
      isKnockIntent: false,
    });
    assert.equal(decision.action, "task_poll");
  });

  it("still allows granted peers without treating them as knocks", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: true,
      trustGrantId: "00000000-0000-4000-8000-000000000001",
      isKnockIntent: false,
    });
    assert.deepEqual(decision, {
      action: "allow",
      trustGrantId: "00000000-0000-4000-8000-000000000001",
    });
  });
});
