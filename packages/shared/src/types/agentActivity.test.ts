import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JACKLINE_TOOL_CALL_INTENT } from "@jackline/shared";

// Light unit coverage for transcript shaping helpers by reusing the exported
// response schema against synthetic entries (DB-backed path covered in CI/integration).
import {
  AgentTranscriptEntrySchema,
  AgentTranscriptResponseSchema,
} from "@jackline/shared";

describe("agent transcript schemas", () => {
  it("accepts a knock + decision + message transcript", () => {
    const payload = {
      threads: [
        {
          peerAgentCardUrl: "https://example.test/peer/card.json",
          peerDisplayName: "Chief of Staff",
          trustGrantId: "00000000-0000-4000-8000-000000000001",
          knockId: "00000000-0000-4000-8000-000000000002",
          knockStatus: "approved",
          lastActivityAt: "2026-09-10T02:00:00.000Z",
          entryCount: 3,
        },
      ],
      entries: [
        {
          id: "knock:1",
          kind: "knock",
          createdAt: "2026-09-10T01:00:00.000Z",
          peerAgentCardUrl: "https://example.test/peer/card.json",
          peerDisplayName: "Chief of Staff",
          knockId: "00000000-0000-4000-8000-000000000002",
          trustGrantId: null,
          taskId: null,
          text: "Please grant access",
          status: "approved",
          decisionNote: null,
          toolName: null,
          toolArgs: null,
          toolOutput: null,
          taskState: null,
        },
        {
          id: "decision:1",
          kind: "decision",
          createdAt: "2026-09-10T01:05:00.000Z",
          peerAgentCardUrl: "https://example.test/peer/card.json",
          peerDisplayName: "Chief of Staff",
          knockId: "00000000-0000-4000-8000-000000000002",
          trustGrantId: "00000000-0000-4000-8000-000000000001",
          taskId: null,
          text: null,
          status: "approved",
          decisionNote: "Looks legit",
          toolName: null,
          toolArgs: null,
          toolOutput: null,
          taskState: null,
        },
        {
          id: "task:1:tool",
          kind: "tool_call",
          createdAt: "2026-09-10T02:00:00.000Z",
          peerAgentCardUrl: "https://example.test/peer/card.json",
          peerDisplayName: "Chief of Staff",
          knockId: null,
          trustGrantId: "00000000-0000-4000-8000-000000000001",
          taskId: "00000000-0000-4000-8000-000000000003",
          text: "please echo",
          status: null,
          decisionNote: null,
          toolName: "echo",
          toolArgs: { message: "hi", intent: JACKLINE_TOOL_CALL_INTENT },
          toolOutput: "echo:hi",
          taskState: "completed",
        },
      ],
    };

    const parsed = AgentTranscriptResponseSchema.safeParse(payload);
    assert.equal(parsed.success, true);
    assert.equal(
      AgentTranscriptEntrySchema.safeParse(payload.entries[1]).success,
      true,
    );
  });
});
