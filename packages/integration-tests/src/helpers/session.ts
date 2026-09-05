import type { ApiClient } from "./client.js";

export type AuthenticatedAdmin = {
  tenantId: string;
  /** Tenant slug — required for multi-tenant MCP OAuth DCR / CIMD. */
  tenantSlug: string;
  email: string;
};

export async function createAuthenticatedAdmin(
  client: ApiClient,
  label: string,
): Promise<AuthenticatedAdmin> {
  const email = `${label}-${Date.now()}@jackline.local`;
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
      name: "Integration Admin",
      organizationName: `Integration Org ${Date.now()}`,
    }),
  });

  const signupJson = (await signup.json()) as {
    success?: boolean;
    data?: { tenant: { id: string; slug: string } };
    error?: { message?: string };
  };
  if (!signup.ok || !signupJson.success || !signupJson.data) {
    throw new Error(
      `signup failed: ${signupJson.error?.message ?? signup.status}`,
    );
  }

  const tenantId = signupJson.data.tenant.id;
  const tenantSlug = signupJson.data.tenant.slug;

  const { db, user: userTable } = await import("@jackline/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(userTable)
    .set({ emailVerified: true })
    .where(eq(userTable.email, email));

  await client.signIn(email, password);

  return { tenantId, tenantSlug, email };
}
