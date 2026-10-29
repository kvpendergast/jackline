import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAllowedTools } from "@jackline/policy";

describe("getAllowedTools", () => {
  it("deny wins when the same tool appears more than once", () => {
    const policy = getAllowedTools([
      {
        id: "t1",
        status: "active",
        permission: "allow",
        serverStatus: "active",
      },
      {
        id: "t1",
        status: "active",
        permission: "deny",
        serverStatus: "active",
      },
    ]);

    assert.equal(policy.isOk(), true);
    if (policy.isOk()) {
      assert.deepEqual(policy.value, []);
    }
  });
});
