import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOtelConfig } from "./config.js";
import { withSpan } from "./init.js";

describe("withSpan", () => {
  it("runs the callback when export is disabled", async () => {
    const otel = resolveOtelConfig({ serviceName: "jackline-test" });
    assert.equal(otel.isOk(), true);
    if (otel.isErr()) return;

    const value = await withSpan(otel.value, {
      name: "jackline.tool.call",
      fn: async () => "ok",
    });
    assert.equal(value, "ok");
  });

  it("propagates errors from the callback", async () => {
    const otel = resolveOtelConfig({ serviceName: "jackline-test" });
    assert.equal(otel.isOk(), true);
    if (otel.isErr()) return;

    await assert.rejects(
      () =>
        withSpan(otel.value, {
          name: "jackline.tool.call",
          fn: async () => {
            throw new Error("boom");
          },
        }),
      /boom/,
    );
  });
});
