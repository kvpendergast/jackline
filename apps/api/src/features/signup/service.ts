import { count, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import {
  createHumanUserWithSession,
  reloadAuth,
} from "@jackline/auth";
import { db, memberships, tenants, user } from "@jackline/db";
import {
  assertCanCreateTenant,
  BadRequestError,
  getConfig,
  JacklineError,
  SetupError,
  type PublicMembership,
  type PublicTenant,
  type PublicUser,
} from "@jackline/shared";
import type { Logger } from "pino";
import { slugify } from "../../lib/slug.js";

export type SignupInput = {
  email: string;
  password: string;
  name: string;
  organizationName: string;
};

export type SignupSuccess = {
  user: PublicUser;
  tenant: PublicTenant;
  membership: PublicMembership;
  authResponse: Response;
};

export type SignupStatus = {
  /** True when `/api/v1/signup` can create a new organization. */
  open: boolean;
};

async function status(
  log: Logger,
): Promise<Result<SignupStatus, JacklineError>> {
  const configResult = getConfig();
  if (configResult.isErr()) {
    return err(configResult.error);
  }

  const [{ value: tenantCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(tenants);

  const gate = assertCanCreateTenant(
    tenantCount,
    configResult.value.JACKLINE_TENANCY,
  );
  const open = gate.isOk();
  log.debug({ tenantCount, open }, "signup status");
  return ok({ open });
}

async function create(
  log: Logger,
  input: SignupInput,
): Promise<Result<SignupSuccess, JacklineError>> {
  const configResult = getConfig();
  if (configResult.isErr()) {
    return err(configResult.error);
  }

  const [{ value: tenantCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(tenants);

  const gate = assertCanCreateTenant(
    tenantCount,
    configResult.value.JACKLINE_TENANCY,
  );
  if (gate.isErr()) {
    return err(gate.error);
  }

  const created = await createHumanUserWithSession({
    email: input.email,
    password: input.password,
    name: input.name,
  });
  if (!created.ok) {
    return err(new BadRequestError(created.message));
  }

  const { user: createdUser, authResponse } = created;
  const userId = createdUser.id;
  const slug = slugify(input.organizationName);

  if (!slug) {
    await db.delete(user).where(eq(user.id, userId));
    return err(new BadRequestError("organizationName produces an empty slug"));
  }

  try {
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: input.organizationName,
        slug,
      })
      .returning();

    if (!tenant) {
      throw new SetupError("Failed to create tenant");
    }

    const [membership] = await db
      .insert(memberships)
      .values({
        userId,
        tenantId: tenant.id,
        role: "full_admin",
      })
      .returning();

    if (!membership) {
      throw new SetupError("Failed to create membership");
    }

    // Close Better Auth public email signup now that a tenant exists.
    await reloadAuth();

    log.info(
      { userId, tenantId: tenant.id, membershipId: membership.id },
      "organization created",
    );

    return ok({
      user: {
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        kind: "human",
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      membership: {
        id: membership.id,
        userId: membership.userId,
        tenantId: membership.tenantId,
        role: membership.role as "full_admin",
        team: membership.team,
      },
      authResponse,
    });
  } catch (cause) {
    await db.delete(user).where(eq(user.id, userId));
    if (cause instanceof JacklineError) {
      return err(cause);
    }
    const message =
      cause instanceof Error ? cause.message : "Failed to create organization";
    return err(new SetupError(message));
  }
}

export const signupServices = { create, status } as const;
