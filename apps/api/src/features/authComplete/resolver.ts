import {
  emailDomain,
  isTenantOidcProvider,
  tenantOidcProviderId,
  type AuthCompleteIntent,
  type AuthCompleteResult,
  type MembershipRole,
} from "@jackline/shared";

export type MembershipWithSso = {
  tenantId: string;
  requireSso: boolean;
  ssoEnabled: boolean;
};

export type TenantDomainMatch = {
  tenantId: string;
  requireSso: boolean;
  ssoEnabled: boolean;
  autoCreateUsers: boolean;
  autoJoinRole: MembershipRole;
};

export type ResolveAuthCompleteInput = {
  email: string;
  loginProvider: string | null;
  intent: AuthCompleteIntent;
  memberships: MembershipWithSso[];
  domainTenants: TenantDomainMatch[];
  canCreateTenant: boolean;
  organizationName?: string;
};

function satisfiesTenantSso(
  loginProvider: string | null,
  tenantId: string,
): boolean {
  if (!loginProvider) return false;
  return loginProvider === tenantOidcProviderId(tenantId);
}

export function resolveAuthComplete(
  input: ResolveAuthCompleteInput,
): AuthCompleteResult {
  for (const membership of input.memberships) {
    if (
      membership.requireSso &&
      membership.ssoEnabled &&
      !satisfiesTenantSso(input.loginProvider, membership.tenantId)
    ) {
      return {
        status: "require_sso",
        providerId: tenantOidcProviderId(membership.tenantId),
        tenantId: membership.tenantId,
        reason: "membership",
      };
    }
  }

  if (input.memberships.length > 0) {
    return { status: "ok" };
  }

  const domain = emailDomain(input.email);
  if (domain && input.domainTenants.length > 1) {
    return {
      status: "no_access",
      message:
        "Your email domain matches multiple organizations. Contact an administrator for an invite.",
    };
  }

  if (domain && input.domainTenants.length === 1) {
    const tenant = input.domainTenants[0]!;
    if (!tenant.ssoEnabled) {
      return {
        status: "no_access",
        message: "No organization membership found for this account.",
      };
    }

    if (!satisfiesTenantSso(input.loginProvider, tenant.tenantId)) {
      return {
        status: "require_sso",
        providerId: tenantOidcProviderId(tenant.tenantId),
        tenantId: tenant.tenantId,
        reason: "domain_join",
      };
    }
  }

  if (input.intent === "signup") {
    if (!input.canCreateTenant) {
      return {
        status: "no_access",
        message: "Organization creation is not available on this instance.",
      };
    }
    if (input.organizationName) {
      return { status: "ok" };
    }
    return { status: "founder_signup" };
  }

  return {
    status: "no_access",
    message: "No organization membership found for this account.",
  };
}

export function shouldAutoJoinByDomain(
  tenant: TenantDomainMatch,
  loginProvider: string | null,
  email: string,
  domainTenants: TenantDomainMatch[],
): boolean {
  const domain = emailDomain(email);
  if (!domain || !tenant.autoCreateUsers || !tenant.ssoEnabled) {
    return false;
  }
  if (domainTenants.length !== 1) return false;
  if (domainTenants[0]!.tenantId !== tenant.tenantId) return false;
  return (
    isTenantOidcProvider(loginProvider ?? "") &&
    satisfiesTenantSso(loginProvider, tenant.tenantId)
  );
}
