import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestError, JACKLINE_TOOL_CALL_INTENT } from "@jackline/shared";

import {
  extractPeerMessageText,
  extractToolCallRequest,
} from "./a2aProtocol.js";
import { resolveBoundToolName, type BoundAgentTool } from "./boundTools.js";

describe("extractPeerMessageText", () => {
  it("reads text parts", () => {
    const result = extractPeerMessageText({
      message: {
        parts: [{ kind: "text", text: "hello peer" }],
      },
    });
    assert.equal(result.isOk(), true);
    if (result.isOk()) assert.equal(result.value, "hello peer");
  });

  it("rejects empty text", () => {
    const result = extractPeerMessageText({
      message: { parts: [{ kind: "text", text: "   " }] },
    });
    assert.equal(result.isErr(), true);
    if (result.isErr()) assert.ok(result.error instanceof BadRequestError);
  });
});

describe("extractToolCallRequest", () => {
  it("returns null when intent is not a tool call", () => {
    const result = extractToolCallRequest({
      message: {
        parts: [{ kind: "text", text: "hi" }],
        metadata: { intent: "jackline.trust.request" },
      },
    });
    assert.equal(result.isOk(), true);
    if (result.isOk()) assert.equal(result.value, null);
  });

  it("parses structured tool call metadata", () => {
    const result = extractToolCallRequest({
      message: {
        parts: [{ kind: "text", text: "run echo" }],
        metadata: {
          intent: JACKLINE_TOOL_CALL_INTENT,
          tool: {
            name: "demo__echo",
            arguments: { message: "phase-b" },
          },
        },
      },
    });
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.deepEqual(result.value, {
        name: "demo__echo",
        arguments: { message: "phase-b" },
      });
    }
  });

  it("requires tool.name", () => {
    const result = extractToolCallRequest({
      message: {
        parts: [{ kind: "text", text: "run" }],
        metadata: {
          intent: JACKLINE_TOOL_CALL_INTENT,
          tool: { arguments: {} },
        },
      },
    });
    assert.equal(result.isErr(), true);
  });
});

describe("resolveBoundToolName", () => {
  const bound: BoundAgentTool[] = [
    {
      toolId: "t1",
      name: "echo",
      serverId: "s1",
      serverName: "demo-server",
      mcpName: "demo-server__echo",
      description: null,
    },
  ];

  it("matches mcp name", () => {
    assert.equal(
      resolveBoundToolName(bound, "demo-server__echo")?.toolId,
      "t1",
    );
  });

  it("matches local tool name", () => {
    assert.equal(resolveBoundToolName(bound, "echo")?.toolId, "t1");
  });

  it("returns undefined for unbound tools", () => {
    assert.equal(resolveBoundToolName(bound, "other"), undefined);
  });
});
