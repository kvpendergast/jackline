import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "./helpers/fixtures.js";
import { createAuthenticatedAdmin } from "./helpers/session.js";

describe("auth session", () => {
  it("signup and sign-in returns the authenticated user on GET /api/v1/me", async () => {
    const client = await createApiClient();
    const { tenantId, email } = await createAuthenticatedAdmin(
      client,
      "auth-session",
    );

    const me = await client.api<{ user: { email: string } }>("/api/v1/me", {
      tenantId,
    });

    assert.equal(me.data.user.email, email);
  });

  it("disables Better Auth public email signup after the first organization", async () => {
    const client = await createApiClient();
    await createAuthenticatedAdmin(client, "signup-lock");

    const status = await client.api<{ open: boolean }>("/api/v1/signup/status");
    // Integration stack runs JACKLINE_TENANCY=multi, so org signup stays open.
    assert.equal(status.data.open, true);

    const blocked = await fetch(`${client.apiUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        Origin: client.webOrigin,
      },
      body: JSON.stringify({
        email: `orphan-${Date.now()}@jackline.local`,
        password: "integration-password-12345",
        name: "Orphan",
      }),
    });

    assert.equal(blocked.ok, false);
    const body = (await blocked.json()) as {
      code?: string;
      message?: string;
    };
    assert.match(
      `${body.code ?? ""} ${body.message ?? ""}`,
      /EMAIL_PASSWORD_SIGN_UP_DISABLED|not enabled/i,
    );
  });
});

describe("email verification without an email provider", () => {
  it("still requires verification on multi-tenant instances (open signup)", async () => {
    const client = await createApiClient();

    const status = await client.api<{
      deliveryReady: boolean;
      verificationSkipped: boolean;
    }>("/api/v1/platform/email/status");
    assert.equal(status.data.deliveryReady, false);
    // Integration stack runs JACKLINE_TENANCY=multi: the no-email bypass is
    // single-tenant only, so an unverified address must never be trusted.
    assert.equal(status.data.verificationSkipped, false);

    const email = `unverified-${Date.now()}@jackline.local`;
    const password = "integration-password-12345";
    const signup = await fetch(`${client.apiUrl}/api/v1/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        Origin: client.webOrigin,
      },
      body: JSON.stringify({
        email,
        password,
        name: "Unverified Admin",
        organizationName: `Unverified Org ${Date.now()}`,
      }),
    });
    const signupJson = (await signup.json()) as {
      data?: { user: { emailVerified: boolean } };
    };
    assert.equal(signup.status, 201);
    assert.equal(signupJson.data?.user.emailVerified, false);

    const signIn = await fetch(`${client.apiUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "application/json",
        Origin: client.webOrigin,
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(signIn.status, 403);
    const body = (await signIn.json()) as { code?: string };
    assert.equal(body.code, "EMAIL_NOT_VERIFIED");
  });
});
