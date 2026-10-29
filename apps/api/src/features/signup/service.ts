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
import { ensureJacklineChatClient } from "../chat/ensure.js";
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

async function createOrganizationForUser(
  log: Logger,
  existingUser: PublicUser,
  organizationName: string,
): Promise<
  Result<
    {
      user: PublicUser;
      tenant: PublicTenant;
      membership: PublicMembership;
    },
    JacklineError
  >
> {
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

  const slug = slugify(organizationName);
  if (!slug) {
    return err(new BadRequestError("organizationName produces an empty slug"));
  }

  try {
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: organizationName,
        slug,
      })
      .returning();

    if (!tenant) {
      throw new SetupError("Failed to create tenant");
    }

    const [membership] = await db
      .insert(memberships)
      .values({
        userId: existingUser.id,
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
      {
        userId: existingUser.id,
        tenantId: tenant.id,
        membershipId: membership.id,
      },
      "organization created for existing user",
    );

    const chatClient = await ensureJacklineChatClient(log, tenant.id);
    if (chatClient.isErr()) {
      log.warn(
        { tenantId: tenant.id, errorCode: chatClient.error.code },
        "failed to seed Jackline Chat client",
      );
    }

    return ok({
      user: existingUser,
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
    });
  } catch (cause) {
    if (cause instanceof JacklineError) {
      return err(cause);
    }
    const message =
      cause instanceof Error ? cause.message : "Failed to create organization";
    return err(new SetupError(message));
  }
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

  const callbackURL = `${configResult.value.WEB_ORIGIN.replace(/\/$/, "")}/auth/complete?intent=login`;
  const created = await createHumanUserWithSession({
    email: input.email,
    password: input.password,
    name: input.name,
    callbackURL,
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
    const org = await createOrganizationForUser(
      log,
      {
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        kind: "human",
        emailVerified: createdUser.emailVerified,
      },
      input.organizationName,
    );
    if (org.isErr()) {
      await db.delete(user).where(eq(user.id, userId));
      return err(org.error);
    }

    return ok({
      ...org.value,
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

async function createSocial(
  log: Logger,
  existingUser: PublicUser,
  organizationName: string,
): Promise<
  Result<
    {
      user: PublicUser;
      tenant: PublicTenant;
      membership: PublicMembership;
    },
    JacklineError
  >
> {
  return createOrganizationForUser(log, existingUser, organizationName);
}

export const signupServices = {
  status,
  create,
  createSocial,
  createOrganizationForUser,
} as const;
