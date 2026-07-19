import { db, memberships, tenants } from "@mesh/db";
import { MeshError, type PublicTenant, type PublicUser } from "@mesh/shared";
import { eq } from "drizzle-orm";
import { ok, type Result } from "neverthrow";
import type { Logger } from "pino";

type MeSuccess = {
  user: PublicUser;
  memberships: {
    id: string;
    role: string;
    tenant: PublicTenant;
  }[];
};

export async function getMe(
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
    memberships: rows.map(({ memberships: membership, tenants: tenant }) => ({
      id: membership.id,
      role: membership.role,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    })),
  });
}
