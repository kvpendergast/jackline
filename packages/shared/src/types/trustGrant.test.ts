import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  effectiveTrustGrantStatus,
  isTrustGrantUsable,
} from "./trustGrant.js";

describe("trust grant lifecycle", () => {
  const expiresAt = new Date("2026-01-02T00:00:00.000Z");

  it("marks expired grants", () => {
    assert.equal(
      effectiveTrustGrantStatus(
        "active",
        expiresAt,
        new Date("2026-01-03T00:00:00.000Z"),
      ),
      "expired",
    );
  });

  it("keeps active grants before expiry", () => {
    assert.equal(
      effectiveTrustGrantStatus(
        "active",
        expiresAt,
        new Date("2026-01-01T00:00:00.000Z"),
      ),
      "active",
    );
  });

  it("rejects revoked grants", () => {
    assert.equal(
      isTrustGrantUsable(
        "active",
        expiresAt,
        new Date("2026-01-01T00:00:00.000Z"),
      ),
      false,
    );
    assert.equal(
      isTrustGrantUsable(
        "active",
        expiresAt,
        null,
        new Date("2026-01-01T00:00:00.000Z"),
      ),
      true,
    );
  });
});
