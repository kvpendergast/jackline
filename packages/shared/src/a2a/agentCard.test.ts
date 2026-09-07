import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAgentCard, decideA2aAuth } from "./agentCard.js";

describe("buildAgentCard", () => {
  it("advertises public skills on the card", () => {
    const card = buildAgentCard({
      handle: "alice",
      displayName: "Alice",
      description: "Demo",
      publicSkills: [
        {
          id: "calendar.book",
          name: "Book meeting",
          description: "Schedule on the owner calendar",
        },
      ],
      knocksEnabled: true,
      publicBaseUrl: "https://example.test",
      status: "published",
    });
    assert.deepEqual(card["skills"], [
      {
        id: "calendar.book",
        name: "Book meeting",
        description: "Schedule on the owner calendar",
        tags: [],
      },
    ]);
  });
});

describe("decideA2aAuth", () => {
  it("allows granted peers", () => {
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

  it("routes strangers to knock path", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: true,
    });
    assert.equal(decision.action, "knock_only");
  });

  it("denies when knocks disabled", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: false,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: true,
    });
    assert.equal(decision.action, "deny");
  });

  it("denies paused agents", () => {
    const decision = decideA2aAuth({
      agentStatus: "paused",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: true,
    });
    assert.equal(decision.action, "deny");
  });

  it("requires auth for non-knock calls", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "message/send",
      hasValidGrant: false,
      isKnockIntent: false,
    });
    assert.equal(decision.action, "deny");
  });

  it("allows tasks/get poll with Jackline API credential", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "tasks/get",
      hasValidGrant: false,
      isKnockIntent: false,
      hasApiCredential: true,
    });
    assert.equal(decision.action, "task_poll");
  });

  it("denies tasks/get without credential or grant", () => {
    const decision = decideA2aAuth({
      agentStatus: "published",
      knocksEnabled: true,
      method: "tasks/get",
      hasValidGrant: false,
      isKnockIntent: false,
      hasApiCredential: false,
    });
    assert.equal(decision.action, "deny");
  });
});
