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
