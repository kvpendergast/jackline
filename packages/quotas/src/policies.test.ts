import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bucketToEnvSuffix,
  parseWindowSeconds,
  resolveQuotaPolicies,
  DEFAULT_QUOTA_POLICIES,
} from "./policies.js";
import { createMemoryQuotaStore } from "./stores/memory.js";
import { createQuotaLimiter } from "./limiter.js";

describe("parseWindowSeconds", () => {
  it("parses bare seconds and unit suffixes", () => {
    assert.equal(parseWindowSeconds("60"), 60);
    assert.equal(parseWindowSeconds("60s"), 60);
    assert.equal(parseWindowSeconds("5m"), 300);
    assert.equal(parseWindowSeconds("1h"), 3600);
    assert.equal(parseWindowSeconds("1d"), 86400);
  });

  it("rejects invalid values", () => {
    assert.equal(parseWindowSeconds(""), null);
    assert.equal(parseWindowSeconds("0"), null);
    assert.equal(parseWindowSeconds("nope"), null);
  });
});

describe("resolveQuotaPolicies", () => {
  it("applies JACKLINE_RL env overrides", () => {
    const policies = resolveQuotaPolicies({
      JACKLINE_RL_A2A_KNOCK_LIMIT: "3",
      JACKLINE_RL_A2A_KNOCK_WINDOW: "30m",
    });
    assert.equal(policies["a2a.knock"].limit, 3);
    assert.equal(policies["a2a.knock"].windowSeconds, 1800);
    assert.deepEqual(policies["api.default"], DEFAULT_QUOTA_POLICIES["api.default"]);
  });

  it("maps bucket names to env suffixes", () => {
    assert.equal(bucketToEnvSuffix("api.default"), "API_DEFAULT");
    assert.equal(bucketToEnvSuffix("a2a.knock"), "A2A_KNOCK");
  });
});

describe("createQuotaLimiter (memory)", () => {
  it("allows under the limit and blocks when exceeded", async () => {
    const limiter = createQuotaLimiter({
      store: createMemoryQuotaStore(),
      policies: {
        ...DEFAULT_QUOTA_POLICIES,
        "api.default": { limit: 2, windowSeconds: 60 },
      },
    });

    const a = await limiter.consume("api.default", ["tenant:1", "user:a"]);
    const b = await limiter.consume("api.default", ["tenant:1", "user:a"]);
    const c = await limiter.consume("api.default", ["tenant:1", "user:a"]);

    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
    assert.equal(c.allowed, false);
    assert.equal(c.remaining, 0);
    assert.ok(c.retryAfterSeconds >= 1);
  });

  it("isolates different identity keys", async () => {
    const limiter = createQuotaLimiter({
      store: createMemoryQuotaStore(),
      policies: {
        ...DEFAULT_QUOTA_POLICIES,
        "api.default": { limit: 1, windowSeconds: 60 },
      },
    });

    const first = await limiter.consume("api.default", ["user:1"]);
    const second = await limiter.consume("api.default", ["user:2"]);
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
  });

  it("fails open when the store throws", async () => {
    const limiter = createQuotaLimiter({
      store: {
        async increment() {
          throw new Error("redis down");
        },
      },
      failOpen: true,
    });

    const result = await limiter.consume("api.default", ["user:1"]);
    assert.equal(result.allowed, true);
    assert.equal(result.degraded, true);
  });
});
