import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  autoVerifyPasswordSignIn,
  isEmailVerificationBypassed,
  setEmailVerificationBypassPolicy,
  shouldBypassEmailVerification,
} from "./emailVerificationBypass.js";

describe("shouldBypassEmailVerification", () => {
  it("never bypasses when email delivery is configured", () => {
    assert.equal(
      shouldBypassEmailVerification({ deliveryReady: true, tenancy: "single" }),
      false,
    );
    assert.equal(
      shouldBypassEmailVerification({ deliveryReady: true, tenancy: "multi" }),
      false,
    );
  });

  it("bypasses on a single-tenant instance without email delivery", () => {
    assert.equal(
      shouldBypassEmailVerification({ deliveryReady: false, tenancy: "single" }),
      true,
    );
  });

  it("does not bypass on multi-tenant instances (open signup)", () => {
    assert.equal(
      shouldBypassEmailVerification({ deliveryReady: false, tenancy: "multi" }),
      false,
    );
  });
});

describe("isEmailVerificationBypassed", () => {
  afterEach(() => setEmailVerificationBypassPolicy(null));

  it("fails closed with no policy or a throwing policy", async () => {
    assert.equal(await isEmailVerificationBypassed(), false);
    setEmailVerificationBypassPolicy(async () => {
      throw new Error("db down");
    });
    assert.equal(await isEmailVerificationBypassed(), false);
  });

  it("follows the registered policy", async () => {
    setEmailVerificationBypassPolicy(async () => true);
    assert.equal(await isEmailVerificationBypassed(), true);
  });
});

describe("autoVerifyPasswordSignIn", () => {
  function deps(overrides: {
    bypassed?: boolean;
    emailVerified?: boolean;
    passwordOk?: boolean;
    userExists?: boolean;
  }) {
    const marked: string[] = [];
    const lookedUp: string[] = [];
    return {
      marked,
      lookedUp,
      deps: {
        isBypassed: async () => overrides.bypassed ?? true,
        findPasswordUser: async (email: string) => {
          lookedUp.push(email);
          if (overrides.userExists === false) return null;
          return {
            user: { id: "u1", emailVerified: overrides.emailVerified ?? false },
            passwordHash: "hash",
          };
        },
        verifyPassword: async () => overrides.passwordOk ?? true,
        markVerified: async (id: string) => {
          marked.push(id);
        },
      },
    };
  }

  const creds = { email: "Admin@Example.com", password: "correct horse" };

  it("marks an unverified user verified when bypassed and the password is right", async () => {
    const t = deps({});
    assert.equal(await autoVerifyPasswordSignIn(creds, t.deps), true);
    assert.deepEqual(t.marked, ["u1"]);
    assert.deepEqual(t.lookedUp, ["admin@example.com"]);
  });

  it("does nothing when email delivery is configured (no bypass)", async () => {
    const t = deps({ bypassed: false });
    assert.equal(await autoVerifyPasswordSignIn(creds, t.deps), false);
    assert.deepEqual(t.marked, []);
    assert.deepEqual(t.lookedUp, []);
  });

  it("does nothing on a wrong password", async () => {
    const t = deps({ passwordOk: false });
    assert.equal(await autoVerifyPasswordSignIn(creds, t.deps), false);
    assert.deepEqual(t.marked, []);
  });

  it("does nothing for unknown or already-verified users", async () => {
    const missing = deps({ userExists: false });
    assert.equal(await autoVerifyPasswordSignIn(creds, missing.deps), false);
    const verified = deps({ emailVerified: true });
    assert.equal(await autoVerifyPasswordSignIn(creds, verified.deps), false);
    assert.deepEqual([...missing.marked, ...verified.marked], []);
  });

  it("ignores malformed bodies", async () => {
    const t = deps({});
    assert.equal(
      await autoVerifyPasswordSignIn({ email: 1, password: null }, t.deps),
      false,
    );
    assert.deepEqual(t.marked, []);
  });
});
