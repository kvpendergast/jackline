import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OAuthApp } from "@jackline/db";
import { PublicOAuthAppSchema, UpdateOAuthAppBodySchema } from "@jackline/shared";
import {
  decideOAuthAppDelete,
  planOAuthAppPatch,
  toPublicOAuthApp,
} from "./logic.js";

function row(overrides: Partial<OAuthApp> = {}): OAuthApp {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    name: "Google Workspace",
    clientId: "123.apps.googleusercontent.com",
    authorizeUrl: null,
    tokenUrl: "https://oauth2.googleapis.com/token",
    registrationUrl: null,
    clientSecretCiphertext: Buffer.from("ciphertext-bytes"),
    clientSecretNonce: Buffer.from("nonce-bytes"),
    clientSecretKeyVersion: 1,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-02T00:00:00Z"),
    ...overrides,
  };
}

describe("toPublicOAuthApp", () => {
  it("never exposes the secret or its ciphertext", () => {
    const pub = toPublicOAuthApp(row(), 2);
    const json = JSON.stringify(pub);
    assert.ok(!json.includes("ciphertext"));
    assert.ok(!json.includes("nonce"));
    assert.ok(!("clientSecret" in pub));
    assert.equal(pub.hasClientSecret, true);
    assert.equal(pub.linkedServerCount, 2);
    // Strict schema rejects any extra (secret) field.
    assert.ok(PublicOAuthAppSchema.safeParse(pub).success);
    assert.equal(
      PublicOAuthAppSchema.safeParse({ ...pub, clientSecret: "x" }).success,
      false,
    );
  });

  it("reports public clients", () => {
    const pub = toPublicOAuthApp(
      row({
        clientSecretCiphertext: null,
        clientSecretNonce: null,
        clientSecretKeyVersion: null,
      }),
      0,
    );
    assert.equal(pub.hasClientSecret, false);
  });
});

describe("planOAuthAppPatch", () => {
  it("rotates the secret when clientSecret is given", () => {
    const plan = planOAuthAppPatch({ clientSecret: "new" });
    assert.deepEqual(plan.secret, { action: "rotate", clientSecret: "new" });
    assert.deepEqual(plan.columns, {});
  });

  it("renames without touching the secret", () => {
    const plan = planOAuthAppPatch({ name: "Renamed", tokenUrl: null });
    assert.deepEqual(plan.secret, { action: "keep" });
    assert.deepEqual(plan.columns, { name: "Renamed", tokenUrl: null });
  });

  it("clears the secret on request", () => {
    assert.deepEqual(planOAuthAppPatch({ clearClientSecret: true }).secret, {
      action: "clear",
    });
  });

  it("schema rejects empty or conflicting updates", () => {
    assert.equal(UpdateOAuthAppBodySchema.safeParse({}).success, false);
    assert.equal(
      UpdateOAuthAppBodySchema.safeParse({ clientSecret: "a", clearClientSecret: true })
        .success,
      false,
    );
  });
});

describe("decideOAuthAppDelete", () => {
  it("deletes an unused app", () => {
    assert.deepEqual(decideOAuthAppDelete([], false), { action: "delete" });
  });

  it("refuses while servers are linked and lists them", () => {
    const d = decideOAuthAppDelete(
      [
        { id: "b", name: "Google Calendar" },
        { id: "a", name: "Gmail" },
      ],
      false,
    );
    assert.equal(d.action, "refuse");
    assert.ok(d.action === "refuse" && d.message.includes("Gmail, Google Calendar"));
  });

  it("detaches linked servers when asked", () => {
    assert.deepEqual(decideOAuthAppDelete([{ id: "a", name: "Gmail" }], true), {
      action: "detach_and_delete",
      serverIds: ["a"],
    });
  });
});
