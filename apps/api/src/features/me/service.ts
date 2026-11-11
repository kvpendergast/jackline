import { db, memberships, tenants, user as userTable } from "@jackline/db";
import {
  getConfig,
  JacklineError,
  MembershipRoleSchema,
  NotFoundError,
  publicMcpUrl,
  type MeCurrentContext,
  type MembershipRole,
  type PublicTenant,
  type PublicUser,
} from "@jackline/shared";
import { and, eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Logger } from "pino";
import type { AuthContext } from "../../lib/request/types.js";

type MeSuccess = {
  user: PublicUser;
  memberships: {
    id: string;
    role: MembershipRole;
    team: string | null;
    tenant: PublicTenant;
  }[];
  mcpUrl?: string;
  current?: MeCurrentContext;
};

function mcpUrlOrUndefined(): string | undefined {
  const config = getConfig();
  return config.isOk() ? publicMcpUrl(config.value) : undefined;
}

async function get(
  log: Logger,
  user: PublicUser,
  bearer?: AuthContext,
): Promise<Result<MeSuccess, JacklineError>> {
  const rows = await db
    .select()
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(
      bearer
        ? and(
            eq(memberships.userId, user.id),
            eq(memberships.tenantId, bearer.tenantId),
          )
        : eq(memberships.userId, user.id),
    );

  log.debug({ userId: user.id, membershipCount: rows.length }, "getMe");

  const mcpUrl = mcpUrlOrUndefined();
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
    ...(mcpUrl ? { mcpUrl } : {}),
    ...(bearer
      ? {
          current: {
            tenantId: bearer.tenantId,
            role: bearer.membership.role,
            team: bearer.membership.team,
            authMethod: bearer.method,
          },
        }
      : {}),
  });
}

/** Load the public user for an OAuth bearer subject. */
async function loadPublicUser(
  userId: string,
): Promise<Result<PublicUser, JacklineError>> {
  const [row] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!row) return err(new NotFoundError("User not found"));
  return ok({
    id: row.id,
    email: row.email,
    name: row.name,
    kind: row.kind === "service" ? "service" : "human",
    emailVerified: row.emailVerified,
  });
}

export const meServices = { get, loadPublicUser } as const;
