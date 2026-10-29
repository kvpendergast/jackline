import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { integrationStack } from "./helpers/stack.js";

describe("service health", () => {
  it("API /health responds ok", async () => {
    const { apiUrl } = await integrationStack();
    const res = await fetch(`${apiUrl}/health`);
    assert.equal(res.ok, true);
  });

  it("gateway /health responds ok", async () => {
    const { gatewayUrl } = await integrationStack();
    const res = await fetch(`${gatewayUrl}/health`);
    assert.equal(res.ok, true);
  });
});
