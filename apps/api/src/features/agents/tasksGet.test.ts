import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestError, NotFoundError } from "@jackline/shared";

import {
  buildTasksGetResult,
  validateAgentToolIds,
} from "./tasksGet.js";

describe("buildTasksGetResult", () => {
  it("returns stored task state and exchange payload", () => {
    const result = buildTasksGetResult(
      "agent-1",
      "task-1",
      {
        id: "task-1",
        agentId: "agent-1",
        state: "completed",
        result: {
          approved: true,
          exchangeToken: "xchg_secret",
        },
        error: null,
      },
    );

    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.equal(result.value.taskId, "task-1");
      assert.equal(result.value.state, "completed");
      assert.deepEqual(result.value.result, {
        approved: true,
        exchangeToken: "xchg_secret",
      });
    }
  });

  it("rejects missing taskId", () => {
    const result = buildTasksGetResult("agent-1", undefined, undefined);
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.ok(result.error instanceof BadRequestError);
    }
  });

  it("rejects tasks for another agent", () => {
    const result = buildTasksGetResult("agent-1", "task-1", {
      id: "task-1",
      agentId: "agent-2",
      state: "completed",
      result: null,
      error: null,
    });
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.ok(result.error instanceof NotFoundError);
    }
  });
});

describe("validateAgentToolIds", () => {
  it("accepts unique subset of tenant tools", () => {
    const result = validateAgentToolIds(
      ["a", "b", "a"],
      new Set(["a", "b", "c"]),
    );
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.deepEqual(result.value, ["a", "b"]);
    }
  });

  it("rejects unknown tool ids", () => {
    const result = validateAgentToolIds(["a", "missing"], new Set(["a"]));
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.ok(result.error instanceof BadRequestError);
    }
  });

  it("allows empty tool set", () => {
    const result = validateAgentToolIds([], new Set(["a"]));
    assert.equal(result.isOk(), true);
    if (result.isOk()) {
      assert.deepEqual(result.value, []);
    }
  });
});
