import { db, memberships, tenants } from "@mesh/db";
import {
  MeshError,
  MembershipRoleSchema,
  type MembershipRole,
  type PublicTenant,
  type PublicUser,
} from "@mesh/shared";
import { eq } from "drizzle-orm";
import { ok, type Result } from "neverthrow";
import type { Logger } from "pino";

type MeSuccess = {
  user: PublicUser;
  memberships: {
    id: string;
    role: MembershipRole;
    team: string | null;
    tenant: PublicTenant;
  }[];
};

async function get(
  log: Logger,
  user: PublicUser,
): Promise<Result<MeSuccess, MeshError>> {
  const rows = await db
    .select()
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(eq(memberships.userId, user.id));

  log.debug({ userId: user.id, membershipCount: rows.length }, "getMe");

  return ok({
    user,
    memberships: rows.map(({ memberships: membership, tenants: tenant }) => {
      const roleParse = MembershipRoleSchema.safeParse(membership.role);
      const role: MembershipRole = roleParse.success
        ? roleParse.data
        : "member";
      return {
        id: membership.id,
        role,
        team: membership.team,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
      };
    }),
  });
}

export const meServices = { get } as const;
