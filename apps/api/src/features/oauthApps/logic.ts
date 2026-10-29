import type { OAuthApp } from "@jackline/db";
import type { PublicOAuthApp, UpdateOAuthAppBody } from "@jackline/shared";

/**
 * Pure helpers for the OAuth apps service (unit-tested without a database).
 */

/** Public view of an app. Never includes the client secret or ciphertext. */
export function toPublicOAuthApp(
  row: OAuthApp,
  linkedServerCount: number,
): PublicOAuthApp {
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    authorizeUrl: row.authorizeUrl,
    tokenUrl: row.tokenUrl,
    registrationUrl: row.registrationUrl,
    hasClientSecret: row.clientSecretCiphertext != null,
    linkedServerCount,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type OAuthAppPatchPlan = {
  /** Plain column updates (name / client id / URLs). */
  columns: Partial<
    Pick<OAuthApp, "name" | "clientId" | "authorizeUrl" | "tokenUrl" | "registrationUrl">
  >;
  /** "rotate" = encrypt and store `clientSecret`; "clear" = remove secret. */
  secret: { action: "keep" } | { action: "rotate"; clientSecret: string } | { action: "clear" };
};

export function planOAuthAppPatch(input: UpdateOAuthAppBody): OAuthAppPatchPlan {
  const columns: OAuthAppPatchPlan["columns"] = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.clientId !== undefined) columns.clientId = input.clientId;
  if (input.authorizeUrl !== undefined) columns.authorizeUrl = input.authorizeUrl;
  if (input.tokenUrl !== undefined) columns.tokenUrl = input.tokenUrl;
  if (input.registrationUrl !== undefined) {
    columns.registrationUrl = input.registrationUrl;
  }
  const secret: OAuthAppPatchPlan["secret"] = input.clientSecret
    ? { action: "rotate", clientSecret: input.clientSecret }
    : input.clearClientSecret
      ? { action: "clear" }
      : { action: "keep" };
  return { columns, secret };
}

export type DeleteDecision =
  | { action: "delete" }
  | { action: "detach_and_delete"; serverIds: string[] }
  | { action: "refuse"; message: string };

/**
 * Delete refuses while servers reference the app unless `detach` is set, in
 * which case those servers are unlinked first (they fall back to their own
 * per-server OAuth fields).
 */
export function decideOAuthAppDelete(
  linked: Array<{ id: string; name: string }>,
  detach: boolean,
): DeleteDecision {
  if (linked.length === 0) return { action: "delete" };
  if (detach) {
    return { action: "detach_and_delete", serverIds: linked.map((s) => s.id) };
  }
  const names = linked
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  return {
    action: "refuse",
    message: `OAuth app is used by ${linked.length} server(s): ${names}. Unlink them first or delete with detach=true.`,
  };
}
