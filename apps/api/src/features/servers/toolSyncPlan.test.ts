import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAllUpstreamTools, planToolSync } from "./toolSyncPlan.js";

const t = (name: string, schema: Record<string, unknown> | null = null) => ({
  name,
  description: null,
  inputSchema: schema,
});

describe("planToolSync", () => {
  const existing = [
    { id: "1", name: "create_transaction", status: "active" as const },
    { id: "2", name: "old_tool", status: "active" as const },
    { id: "3", name: "gone_already", status: "disabled" as const },
  ];

  it("updates existing (schema with new param), creates new, disables removed", () => {
    const withNote = t("create_transaction", {
      type: "object",
      properties: { note: { type: "string" } },
    });
    const plan = planToolSync(existing, [withNote, t("get_profit_and_loss")]);
    assert.deepEqual(plan.toUpdate, [{ id: "1", item: withNote }]);
    assert.deepEqual(plan.toCreate.map((x) => x.name), ["get_profit_and_loss"]);
    assert.deepEqual(plan.toDisable, ["2"]);
  });

  it("empty upstream list disables nothing", () => {
    assert.deepEqual(planToolSync(existing, []).toDisable, []);
  });

  it("ignores duplicate upstream names", () => {
    const plan = planToolSync([], [t("a"), t("a")]);
    assert.equal(plan.toCreate.length, 1);
  });
});

describe("listAllUpstreamTools", () => {
  it("follows nextCursor across pages", async () => {
    const pages: Record<string, { tools: string[]; nextCursor?: string }> = {
      start: { tools: ["a", "b"], nextCursor: "p2" },
      p2: { tools: ["c"], nextCursor: "p3" },
      p3: { tools: ["d"] },
    };
    const seen: Array<string | undefined> = [];
    const all = await listAllUpstreamTools(async (cursor) => {
      seen.push(cursor);
      return pages[cursor ?? "start"]!;
    });
    assert.deepEqual(all, ["a", "b", "c", "d"]);
    assert.deepEqual(seen, [undefined, "p2", "p3"]);
  });

  it("stops on a repeated cursor", async () => {
    let calls = 0;
    const all = await listAllUpstreamTools(async () => {
      calls += 1;
      return { tools: [calls], nextCursor: "same" };
    });
    assert.equal(calls, 2);
    assert.deepEqual(all, [1, 2]);
  });
});
