import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAuthComplete,
  shouldAutoJoinByDomain,
  type TenantDomainMatch,
} from "./resolver.js";

describe("resolveAuthComplete", () => {
  it("forces tenant OIDC when membership requires SSO", () => {
    const result = resolveAuthComplete({
      email: "alice@acme.com",
      loginProvider: "google",
      intent: "login",
      memberships: [
        { tenantId: "11111111-1111-4111-8111-111111111111", requireSso: true, ssoEnabled: true },
      ],
      domainTenants: [],
      canCreateTenant: false,
    });
    assert.equal(result.status, "require_sso");
    if (result.status === "require_sso") {
      assert.equal(result.reason, "membership");
      assert.equal(result.providerId, "oidc-11111111-1111-4111-8111-111111111111");
    }
  });

  it("returns ok when user already has memberships and SSO satisfied", () => {
    const result = resolveAuthComplete({
      email: "alice@acme.com",
      loginProvider: "oidc-11111111-1111-4111-8111-111111111111",
      intent: "login",
      memberships: [
        { tenantId: "11111111-1111-4111-8111-111111111111", requireSso: true, ssoEnabled: true },
      ],
      domainTenants: [],
      canCreateTenant: false,
    });
    assert.equal(result.status, "ok");
  });

  it("routes domain signup through tenant OIDC", () => {
    const tenant: TenantDomainMatch = {
      tenantId: "11111111-1111-4111-8111-111111111111",
      requireSso: true,
      ssoEnabled: true,
      autoCreateUsers: true,
      autoJoinRole: "member",
    };
    const result = resolveAuthComplete({
      email: "bob@acme.com",
      loginProvider: "google",
      intent: "signup",
      memberships: [],
      domainTenants: [tenant],
      canCreateTenant: true,
    });
    assert.equal(result.status, "require_sso");
    if (result.status === "require_sso") {
      assert.equal(result.reason, "domain_join");
    }
  });

  it("returns founder_signup for unclaimed domain", () => {
    const result = resolveAuthComplete({
      email: "founder@gmail.com",
      loginProvider: "google",
      intent: "signup",
      memberships: [],
      domainTenants: [],
      canCreateTenant: true,
    });
    assert.equal(result.status, "founder_signup");
  });
});

describe("shouldAutoJoinByDomain", () => {
  it("auto-joins after tenant OIDC when configured", () => {
    const tenant: TenantDomainMatch = {
      tenantId: "11111111-1111-4111-8111-111111111111",
      requireSso: false,
      ssoEnabled: true,
      autoCreateUsers: true,
      autoJoinRole: "member",
    };
    assert.equal(
      shouldAutoJoinByDomain(
        tenant,
        "oidc-11111111-1111-4111-8111-111111111111",
        "bob@acme.com",
        [tenant],
      ),
      true,
    );
  });
});
