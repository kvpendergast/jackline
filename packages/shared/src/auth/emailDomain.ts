/** Platform Better Auth social provider id for operator-configured Google login. */
export const PLATFORM_GOOGLE_PROVIDER_ID = "google" as const;

export const CREDENTIAL_PROVIDER_ID = "credential" as const;

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Normalize admin-entered domain labels (lowercase, strip leading `@`). */
export function normalizeAllowedDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^@+/, "");
  if (!trimmed || trimmed.includes("@") || trimmed.includes(" ")) {
    return null;
  }
  return trimmed;
}

export function normalizeAllowedDomains(domains: string[]): string[] {
  const out = new Set<string>();
  for (const raw of domains) {
    const normalized = normalizeAllowedDomain(raw);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

export function tenantOidcProviderId(tenantId: string): string {
  return `oidc-${tenantId}`;
}

export function isTenantOidcProvider(providerId: string): boolean {
  return providerId.startsWith("oidc-");
}
