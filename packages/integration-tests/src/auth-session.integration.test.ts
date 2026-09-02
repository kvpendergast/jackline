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
});
