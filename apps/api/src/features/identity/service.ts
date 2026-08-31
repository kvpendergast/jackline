import { and, count, desc, eq, isNull } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import {
  generateInviteToken,
  generateScimToken,
  hashToken,
  reloadAuth,
  ssoProviderId,
  ssoSecretAad,
} from "@jackline/auth";
import { db, invites, memberships, ssoConfigs, tenants, user } from "@jackline/db";
import {
  BadRequestError,
  ForbiddenError,
  JacklineError,
  MembershipRoleSchema,
  NotFoundError,
  SetupError,
  getConfig,
  normalizeAllowedDomains,
  PLATFORM_GOOGLE_PROVIDER_ID,
  type CreateInviteBody,
  type MembershipRole,
  type PublicInvite,
  type PublicSsoConfig,
  type RotateScimTokenResult,
  type UpdateSsoConfigBody,
} from "@jackline/shared";
import { getSecretBox } from "../../lib/secrets/secretBox.js";

function toPublicSso(row: typeof ssoConfigs.$inferSelect): PublicSsoConfig {
  const roleParse = MembershipRoleSchema.safeParse(row.autoJoinRole);
  return {
    id: row.id,
    tenantId: row.tenantId,
    enabled: row.enabled,
    issuer: row.issuer,
    clientId: row.clientId,
    hasClientSecret: row.clientSecretCiphertext != null,
    autoCreateUsers: row.autoCreateUsers,
    requireSso: row.requireSso,
    allowedDomains: row.allowedDomains ?? [],
    autoJoinRole: roleParse.success ? roleParse.data : "member",
    scimEnabled: row.scimEnabled,
    hasScimToken: row.scimTokenHash != null,
    providerId: ssoProviderId(row.tenantId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicInvite(row: typeof invites.$inferSelect): PublicInvite {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role as PublicInvite["role"],
    team: row.team,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    invitedByUserId: row.invitedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureSsoRow(tenantId: string) {
  const [existing] = await db
    .select()
    .from(ssoConfigs)
    .where(eq(ssoConfigs.tenantId, tenantId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(ssoConfigs)
    .values({ tenantId })
    .returning();
  if (!created) throw new SetupError("Failed to create SSO config");
  return created;
}

async function getSso(
  log: Logger,
  tenantId: string,
): Promise<Result<PublicSsoConfig, JacklineError>> {
  const row = await ensureSsoRow(tenantId);
  log.debug({ tenantId }, "getSso");
  return ok(toPublicSso(row));
}

async function updateSso(
  log: Logger,
  tenantId: string,
  input: UpdateSsoConfigBody,
): Promise<Result<PublicSsoConfig, JacklineError>> {
  const existing = await ensureSsoRow(tenantId);
  const patch: Partial<typeof ssoConfigs.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.issuer !== undefined) patch.issuer = input.issuer;
  if (input.clientId !== undefined) patch.clientId = input.clientId;
  if (input.autoCreateUsers !== undefined) {
    patch.autoCreateUsers = input.autoCreateUsers;
  }
  if (input.requireSso !== undefined) patch.requireSso = input.requireSso;
  if (input.allowedDomains !== undefined) {
    patch.allowedDomains = normalizeAllowedDomains(input.allowedDomains);
  }
  if (input.autoJoinRole !== undefined) patch.autoJoinRole = input.autoJoinRole;
  if (input.scimEnabled !== undefined) patch.scimEnabled = input.scimEnabled;

  if (input.clientSecret !== undefined) {
    if (input.clientSecret === null) {
      patch.clientSecretCiphertext = null;
      patch.clientSecretNonce = null;
      patch.clientSecretKeyVersion = null;
    } else {
      const box = getSecretBox();
      if (box.isErr()) return err(box.error);
      const sealed = box.value.encrypt(
        new TextEncoder().encode(input.clientSecret),
        ssoSecretAad(tenantId),
      );
      if (sealed.isErr()) return err(sealed.error);
      patch.clientSecretCiphertext = sealed.value.ciphertext;
      patch.clientSecretNonce = sealed.value.nonce;
      patch.clientSecretKeyVersion = sealed.value.keyVersion;
    }
  }

  if (patch.enabled === true || (patch.enabled === undefined && existing.enabled)) {
    const issuer = patch.issuer !== undefined ? patch.issuer : existing.issuer;
    const clientId =
      patch.clientId !== undefined ? patch.clientId : existing.clientId;
    const hasSecret =
      patch.clientSecretCiphertext !== undefined
        ? patch.clientSecretCiphertext != null
        : existing.clientSecretCiphertext != null;
    if (!issuer || !clientId || !hasSecret) {
      return err(
        new BadRequestError(
          "Enabled SSO requires issuer, clientId, and clientSecret",
        ),
      );
    }
  }

  if (patch.requireSso === true) {
    const enabled =
      patch.enabled !== undefined ? patch.enabled : existing.enabled;
    const issuer = patch.issuer !== undefined ? patch.issuer : existing.issuer;
    const clientId =
      patch.clientId !== undefined ? patch.clientId : existing.clientId;
    const hasSecret =
      patch.clientSecretCiphertext !== undefined
        ? patch.clientSecretCiphertext != null
        : existing.clientSecretCiphertext != null;
    if (!enabled || !issuer || !clientId || !hasSecret) {
      return err(
        new BadRequestError(
          "Require SSO needs SSO enabled with issuer, clientId, and clientSecret",
        ),
      );
    }
  }

  const [row] = await db
    .update(ssoConfigs)
    .set(patch)
    .where(eq(ssoConfigs.id, existing.id))
    .returning();
  if (!row) return err(new NotFoundError("SSO config not found"));

  await reloadAuth();
  log.info({ tenantId }, "sso config updated");
  return ok(toPublicSso(row));
}

async function rotateScimToken(
  log: Logger,
  tenantId: string,
): Promise<Result<RotateScimTokenResult, JacklineError>> {
  const existing = await ensureSsoRow(tenantId);
  const token = generateScimToken();
  const [row] = await db
    .update(ssoConfigs)
    .set({
      scimTokenHash: hashToken(token),
      scimEnabled: true,
      updatedAt: new Date(),
    })
    .where(eq(ssoConfigs.id, existing.id))
    .returning();
  if (!row) return err(new SetupError("Failed to rotate SCIM token"));

  const config = getConfig();
  if (config.isErr()) return err(config.error);
  const base = config.value.BETTER_AUTH_URL.replace(/\/$/, "");

  log.info({ tenantId }, "scim token rotated");
  return ok({
    token,
    scimBaseUrl: `${base}/scim/v2`,
  });
}

async function listInvites(
  log: Logger,
  tenantId: string,
  actorRole: MembershipRole,
  actorTeam: string | null,
): Promise<Result<PublicInvite[], JacklineError>> {
  const conditions = [
    eq(invites.tenantId, tenantId),
    isNull(invites.acceptedAt),
  ];
  if (actorRole === "delegated_admin") {
    if (!actorTeam) {
      return err(
        new ForbiddenError("delegated_admin must belong to a team"),
      );
    }
    conditions.push(eq(invites.team, actorTeam));
  }

  const rows = await db
    .select()
    .from(invites)
    .where(and(...conditions))
    .orderBy(desc(invites.createdAt))
    .limit(100);
  log.debug({ tenantId, count: rows.length }, "listInvites");
  return ok(rows.map(toPublicInvite));
}

async function createInvite(
  log: Logger,
  tenantId: string,
  invitedByUserId: string,
  actorRole: MembershipRole,
  actorTeam: string | null,
  input: CreateInviteBody,
): Promise<Result<{ invite: PublicInvite; token: string }, JacklineError>> {
  if (actorRole === "delegated_admin") {
    if (input.role === "full_admin") {
      return err(new ForbiddenError("delegated_admin cannot invite full_admin"));
    }
    if (!actorTeam) {
      return err(
        new BadRequestError("delegated_admin must belong to a team to invite"),
      );
    }
  }

  // Delegated admins always invite into their own team.
  const team =
    actorRole === "delegated_admin"
      ? actorTeam
      : input.role === "delegated_admin"
        ? (input.team ?? null)
        : (input.team ?? null);

  if (input.role === "delegated_admin" && !team) {
    return err(new BadRequestError("delegated_admin invites require a team"));
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(invites)
    .values({
      tenantId,
      email: input.email.toLowerCase(),
      role: input.role,
      team,
      tokenHash: hashToken(token),
      expiresAt,
      invitedByUserId,
    })
    .returning();

  if (!row) return err(new SetupError("Failed to create invite"));

  log.info(
    { tenantId, inviteId: row.id, role: row.role },
    "invite created",
  );
  return ok({ invite: toPublicInvite(row), token });
}

async function acceptInvite(
  log: Logger,
  userId: string,
  userEmail: string,
  token: string,
): Promise<Result<PublicInvite, JacklineError>> {
  const tokenHash = hashToken(token);
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);

  if (!invite || invite.acceptedAt) {
    return err(new NotFoundError("Invite not found"));
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return err(new BadRequestError("Invite has expired"));
  }
  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    return err(new ForbiddenError("Invite email does not match signed-in user"));
  }

  const [existing] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, invite.tenantId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(memberships).values({
      tenantId: invite.tenantId,
      userId,
      role: invite.role,
      team: invite.team,
    });
  }

  const [row] = await db
    .update(invites)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(invites.id, invite.id))
    .returning();

  if (!row) return err(new SetupError("Failed to accept invite"));

  log.info({ inviteId: invite.id, userId }, "invite accepted");
  return ok(toPublicInvite(row));
}

async function acceptPendingInviteByEmail(
  log: Logger,
  userId: string,
  userEmail: string,
): Promise<Result<PublicInvite | null, JacklineError>> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.email, userEmail.toLowerCase()),
        isNull(invites.acceptedAt),
      ),
    )
    .limit(1);

  if (!invite) return ok(null);
  if (invite.expiresAt.getTime() < Date.now()) {
    return err(new BadRequestError("Invite has expired"));
  }

  const [existing] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, invite.tenantId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(memberships).values({
      tenantId: invite.tenantId,
      userId,
      role: invite.role,
      team: invite.team,
    });
  }

  const [row] = await db
    .update(invites)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(invites.id, invite.id))
    .returning();

  if (!row) return err(new SetupError("Failed to accept invite"));

  log.info({ inviteId: invite.id, userId }, "pending invite auto-accepted");
  return ok(toPublicInvite(row));
}

async function listAdmins(
  log: Logger,
  tenantId: string,
  actorRole: MembershipRole,
  actorTeam: string | null,
): Promise<
  Result<
    Array<{
      membershipId: string;
      userId: string;
      email: string;
      name: string;
      role: string;
      team: string | null;
    }>,
    JacklineError
  >
> {
  const conditions = [eq(memberships.tenantId, tenantId)];
  if (actorRole === "delegated_admin") {
    if (!actorTeam) {
      return err(
        new ForbiddenError("delegated_admin must belong to a team"),
      );
    }
    conditions.push(eq(memberships.team, actorTeam));
  }

  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      team: memberships.team,
      email: user.email,
      name: user.name,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(...conditions));

  log.debug({ tenantId, count: rows.length }, "listAdmins");
  return ok(
    rows.map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      email: r.email,
      name: r.name,
      role: r.role,
      team: r.team,
    })),
  );
}

async function listLoginProviders(
  log: Logger,
): Promise<
  Result<Array<{ providerId: string; label: string }>, JacklineError>
> {
  const items: Array<{ providerId: string; label: string }> = [];
  const config = getConfig();
  let hidePlatformGoogle = false;

  if (config.isOk()) {
    if (
      config.value.GOOGLE_CLIENT_ID &&
      config.value.GOOGLE_CLIENT_SECRET
    ) {
      if (config.value.JACKLINE_TENANCY === "single") {
        const [{ value: tenantCount } = { value: 0 }] = await db
          .select({ value: count() })
          .from(tenants);
        if (tenantCount === 1) {
          const [row] = await db
            .select({ requireSso: ssoConfigs.requireSso, enabled: ssoConfigs.enabled })
            .from(ssoConfigs)
            .limit(1);
          hidePlatformGoogle = Boolean(row?.enabled && row.requireSso);
        }
      }
      if (!hidePlatformGoogle) {
        items.push({
          providerId: PLATFORM_GOOGLE_PROVIDER_ID,
          label: "Continue with Google",
        });
      }
    }

    if (config.value.JACKLINE_OIDC_ISSUER) {
      items.push({ providerId: "oidc-env", label: "Organization SSO" });
    }
  }

  const rows = await db
    .select({
      tenantId: ssoConfigs.tenantId,
      enabled: ssoConfigs.enabled,
      name: tenants.name,
    })
    .from(ssoConfigs)
    .innerJoin(tenants, eq(tenants.id, ssoConfigs.tenantId))
    .where(eq(ssoConfigs.enabled, true));

  for (const row of rows) {
    items.push({
      providerId: ssoProviderId(row.tenantId),
      label: `${row.name} SSO`,
    });
  }

  log.debug({ count: items.length }, "listLoginProviders");
  return ok(items);
}

export const identityServices = {
  getSso,
  updateSso,
  rotateScimToken,
  listInvites,
  createInvite,
  acceptInvite,
  acceptPendingInviteByEmail,
  listAdmins,
  listLoginProviders,
} as const;
