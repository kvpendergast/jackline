import { count, desc, eq, and } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  LOGIN_PROVIDER_COOKIE,
  verifyLoginProvider,
} from "@jackline/auth";
import {
  account,
  db,
  memberships,
  ssoConfigs,
  tenants,
} from "@jackline/db";
import {
  assertCanCreateTenant,
  emailDomain,
  getConfig,
  JacklineError,
  MembershipRoleSchema,
  normalizeAllowedDomains,
  type AuthCompleteBody,
  type AuthCompleteResult,
  type PublicUser,
} from "@jackline/shared";
import { identityServices } from "../identity/service.js";
import { signupServices } from "../signup/service.js";
import {
  resolveAuthComplete,
  shouldAutoJoinByDomain,
  type MembershipWithSso,
  type TenantDomainMatch,
} from "./resolver.js";

function readLoginProvider(
  cookieHeader: string | undefined,
  secret: string,
  userId: string,
): Promise<string | null> {
  const cookie = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOGIN_PROVIDER_COOKIE}=`))
    ?.slice(LOGIN_PROVIDER_COOKIE.length + 1);

  const fromCookie = verifyLoginProvider(
    cookie ? decodeURIComponent(cookie) : undefined,
    secret,
  );
  if (fromCookie) return Promise.resolve(fromCookie);

  return db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(desc(account.updatedAt))
    .limit(1)
    .then((rows) => rows[0]?.providerId ?? null);
}

async function loadMemberships(userId: string): Promise<MembershipWithSso[]> {
  const rows = await db
    .select({
      tenantId: memberships.tenantId,
      requireSso: ssoConfigs.requireSso,
      ssoEnabled: ssoConfigs.enabled,
    })
    .from(memberships)
    .leftJoin(ssoConfigs, eq(ssoConfigs.tenantId, memberships.tenantId))
    .where(eq(memberships.userId, userId));

  return rows.map((row) => ({
    tenantId: row.tenantId,
    requireSso: row.requireSso ?? false,
    ssoEnabled: row.ssoEnabled ?? false,
  }));
}

async function loadDomainTenants(email: string): Promise<TenantDomainMatch[]> {
  const domain = emailDomain(email);
  if (!domain) return [];

  const rows = await db
    .select()
    .from(ssoConfigs)
    .where(eq(ssoConfigs.enabled, true));

  const matches: TenantDomainMatch[] = [];
  for (const row of rows) {
    const allowed = normalizeAllowedDomains(row.allowedDomains ?? []);
    if (!allowed.includes(domain)) continue;
    const roleParse = MembershipRoleSchema.safeParse(row.autoJoinRole);
    matches.push({
      tenantId: row.tenantId,
      requireSso: row.requireSso,
      ssoEnabled: row.enabled,
      autoCreateUsers: row.autoCreateUsers,
      autoJoinRole: roleParse.success ? roleParse.data : "member",
    });
  }
  return matches;
}

async function autoJoinIfEligible(
  log: Logger,
  user: PublicUser,
  loginProvider: string | null,
  domainTenants: TenantDomainMatch[],
): Promise<void> {
  if (domainTenants.length !== 1) return;
  const tenant = domainTenants[0]!;
  if (
    !shouldAutoJoinByDomain(tenant, loginProvider, user.email, domainTenants)
  ) {
    return;
  }

  const [existing] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenant.tenantId),
        eq(memberships.userId, user.id),
      ),
    )
    .limit(1);
  if (existing) return;

  await db.insert(memberships).values({
    tenantId: tenant.tenantId,
    userId: user.id,
    role: tenant.autoJoinRole,
  });
  log.info(
    { userId: user.id, tenantId: tenant.tenantId, role: tenant.autoJoinRole },
    "domain auto-join membership created",
  );
}

async function complete(
  log: Logger,
  user: PublicUser,
  body: AuthCompleteBody,
  cookieHeader: string | undefined,
): Promise<Result<AuthCompleteResult, JacklineError>> {
  if (body.inviteToken) {
    const accepted = await identityServices.acceptInvite(
      log,
      user.id,
      user.email,
      body.inviteToken,
    );
    if (accepted.isErr()) return err(accepted.error);
    return ok({ status: "ok" });
  }

  const configResult = getConfig();
  if (configResult.isErr()) return err(configResult.error);

  const loginProvider = await readLoginProvider(
    cookieHeader,
    configResult.value.BETTER_AUTH_SECRET,
    user.id,
  );

  let membershipsForUser = await loadMemberships(user.id);
  const domainTenants = await loadDomainTenants(user.email);

  if (body.intent === "signup" && membershipsForUser.length === 0) {
    const pending = await identityServices.acceptPendingInviteByEmail(
      log,
      user.id,
      user.email,
    );
    if (pending.isErr()) return err(pending.error);
    if (pending.value) {
      membershipsForUser = await loadMemberships(user.id);
      return ok({ status: "ok" });
    }
  }

  await autoJoinIfEligible(log, user, loginProvider, domainTenants);
  membershipsForUser = await loadMemberships(user.id);

  const [{ value: tenantCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(tenants);
  const canCreateTenant = assertCanCreateTenant(
    tenantCount,
    configResult.value.JACKLINE_TENANCY,
  ).isOk();

  const decision = resolveAuthComplete({
    email: user.email,
    loginProvider,
    intent: body.intent,
    memberships: membershipsForUser,
    domainTenants,
    canCreateTenant,
    ...(body.organizationName
      ? { organizationName: body.organizationName }
      : {}),
  });

  if (
    decision.status === "ok" &&
    body.intent === "signup" &&
    body.organizationName &&
    membershipsForUser.length === 0
  ) {
    const created = await signupServices.createOrganizationForUser(
      log,
      user,
      body.organizationName,
    );
    if (created.isErr()) return err(created.error);
  }

  return ok(decision);
}

export const authCompleteServices = { complete } as const;
